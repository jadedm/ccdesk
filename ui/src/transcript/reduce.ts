// Reduces raw records into the block model. Pure: (transcript, record) -> transcript.
// Handles two record shapes with one code path:
//   history: { type: 'user' | 'assistant' | 'system', message, uuid }  (the SDK's getSessionMessages)
//   live:    SDK messages, the same shapes plus 'stream_event' and 'result'.

import { countLines, summarise } from './summaries.ts';
import type { Block, Transcript, Turn } from './blocks.ts';

type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content?: string | Array<{ type: string; text?: string }>; is_error?: boolean };

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | ToolResultBlock
  | { type: 'image' }
  | { type: 'document' }
  | { type: string };

type Record_ = {
  type: string;
  subtype?: string;
  uuid?: string;
  isMeta?: boolean;
  message?: { role?: string; content?: string | ContentBlock[]; model?: string };
  event?: StreamEvent;
  is_error?: boolean;
  result?: string;
  model?: string;
  claude_code_version?: string;
  error?: string;
};

type StreamEvent =
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  | { type: 'content_block_delta'; index: number; delta: { type: string; text?: string; thinking?: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: string };

let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${++counter}`;

// Every block is copied, not only the arrays. The appliers below mutate blocks in place on
// the copy, and a shared block object would leak those mutations into the previous state.
// React strict mode runs reducers twice on the same input, which turned that leak into a
// duplicated final message.
const clone = (t: Transcript): Transcript => ({ ...t, turns: t.turns.map((turn) => ({ ...turn, blocks: turn.blocks.map((b) => ({ ...b })) })) });

const currentTurn = (t: Transcript): Turn => {
  const last = t.turns[t.turns.length - 1];
  if (last) return last;
  const turn: Turn = { id: nextId('turn'), blocks: [] };
  t.turns.push(turn);
  return turn;
};

const append = (t: Transcript, block: Block): void => {
  currentTurn(t).blocks.push(block);
};

const skippedUserPrefixes = ['<system-reminder>', '<local-command-caveat>', '<local-command-stdout>', '<task-notification>'];

const userTextToBlock = (text: string): Block | null => {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (skippedUserPrefixes.some((p) => trimmed.startsWith(p))) return null;
  const command = trimmed.match(/^<command-name>([^<]+)<\/command-name>/);
  if (command) return { kind: 'note', id: nextId('note'), text: `ran ${command[1]}`, tone: 'info' };
  const bash = trimmed.match(/^<bash-input>([\s\S]*?)<\/bash-input>/);
  if (bash) return { kind: 'user', id: nextId('user'), text: `! ${bash[1].trim()}` };
  if (trimmed.startsWith('[Request interrupted')) return { kind: 'note', id: nextId('note'), text: 'interrupted by user', tone: 'info' };
  return { kind: 'user', id: nextId('user'), text: trimmed };
};

const resultText = (content: ToolResultBlock): string => {
  if (typeof content.content === 'string') return content.content;
  if (!Array.isArray(content.content)) return '';
  return content.content.map((c) => (c.type === 'text' ? c.text ?? '' : `[${c.type}]`)).join('\n');
};

const findTool = (t: Transcript, toolUseId: string): Extract<Block, { kind: 'tool' }> | null => {
  for (let i = t.turns.length - 1; i >= 0; i--) {
    const block = t.turns[i].blocks.find((b) => b.kind === 'tool' && b.id === toolUseId);
    if (block && block.kind === 'tool') return block;
  }
  return null;
};

const applyUser = (t: Transcript, record: Record_): void => {
  const content = record.message?.content;
  if (typeof content === 'string') {
    const block = record.isMeta ? null : userTextToBlock(content);
    if (!block) return;
    if (block.kind === 'user') t.turns.push({ id: nextId('turn'), blocks: [block] });
    else append(t, block);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (part.type === 'tool_result' && 'tool_use_id' in part) {
      const tool = findTool(t, part.tool_use_id);
      const text = resultText(part as ToolResultBlock);
      const result = { text, isError: part.is_error === true, lines: countLines(text) };
      if (tool) {
        tool.result = result;
        tool.streaming = false;
      } else {
        append(t, { kind: 'note', id: nextId('note'), text: `result for unknown tool ${part.tool_use_id}`, tone: 'info' });
      }
      continue;
    }
    if (part.type === 'text' && 'text' in part) {
      if (record.isMeta) continue;
      const block = userTextToBlock(part.text);
      if (!block) continue;
      if (block.kind === 'user') t.turns.push({ id: nextId('turn'), blocks: [block] });
      else append(t, block);
      continue;
    }
    if (part.type === 'image' || part.type === 'document') {
      append(t, { kind: 'note', id: nextId('note'), text: `attached ${part.type}`, tone: 'info' });
    }
  }
};

const lastStreaming = <K extends Block['kind']>(t: Transcript, kind: K): Extract<Block, { kind: K }> | null => {
  const blocks = currentTurn(t).blocks;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === kind && 'streaming' in b && b.streaming) return b as Extract<Block, { kind: K }>;
  }
  return null;
};

const applyAssistant = (t: Transcript, record: Record_): void => {
  const content = record.message?.content;
  if (record.message?.model && !t.model) t.model = record.message.model;
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (part.type === 'text' && 'text' in part) {
      const open = lastStreaming(t, 'text');
      if (open) {
        open.text = part.text;
        open.streaming = false;
      } else if (part.text.trim() !== '') {
        append(t, { kind: 'text', id: nextId('text'), text: part.text, streaming: false });
      }
      continue;
    }
    if (part.type === 'thinking' && 'thinking' in part) {
      const open = lastStreaming(t, 'thinking');
      if (open) {
        open.text = part.thinking;
        open.streaming = false;
      } else if (part.thinking.trim() !== '') {
        append(t, { kind: 'thinking', id: nextId('thinking'), text: part.thinking, streaming: false });
      }
      continue;
    }
    if (part.type === 'tool_use' && 'id' in part) {
      const existing = findTool(t, part.id);
      if (existing) {
        existing.input = part.input;
        existing.summary = summarise(part.name, part.input);
        continue;
      }
      append(t, { kind: 'tool', id: part.id, name: part.name, input: part.input, summary: summarise(part.name, part.input), streaming: true });
    }
  }
  if (record.error) append(t, { kind: 'note', id: nextId('note'), text: `api error: ${record.error}`, tone: 'error' });
};

const applyStream = (t: Transcript, event: StreamEvent): void => {
  if (event.type === 'content_block_start' && 'content_block' in event) {
    const cb = event.content_block;
    if (cb.type === 'text') append(t, { kind: 'text', id: nextId('text'), text: '', streaming: true });
    if (cb.type === 'thinking') append(t, { kind: 'thinking', id: nextId('thinking'), text: '', streaming: true });
    if (cb.type === 'tool_use' && 'id' in cb) {
      append(t, { kind: 'tool', id: cb.id, name: cb.name, input: {}, summary: cb.name, streaming: true });
    }
    return;
  }
  if (event.type === 'content_block_delta' && 'delta' in event) {
    if (event.delta.type === 'text_delta') {
      const open = lastStreaming(t, 'text');
      if (open) open.text += event.delta.text ?? '';
    }
    if (event.delta.type === 'thinking_delta') {
      const open = lastStreaming(t, 'thinking');
      if (open) open.text += event.delta.thinking ?? '';
    }
  }
};

const applySystem = (t: Transcript, record: Record_): void => {
  if (record.subtype !== 'init') return;
  t.model = record.model ?? t.model;
  t.version = record.claude_code_version ?? t.version;
};

const applyResult = (t: Transcript, record: Record_): void => {
  for (const turn of t.turns) for (const b of turn.blocks) if ('streaming' in b) b.streaming = false;
  if (!record.is_error) return;
  append(t, { kind: 'note', id: nextId('note'), text: record.result ?? 'turn failed', tone: 'error' });
};

const appliers: Record<string, (t: Transcript, r: Record_) => void> = {
  user: applyUser,
  assistant: applyAssistant,
  system: applySystem,
  result: applyResult,
  stream_event: (t, r) => r.event && applyStream(t, r.event),
};

export const reduceRecord = (transcript: Transcript, record: unknown): Transcript => {
  const r = record as Record_;
  const apply = appliers[r.type];
  if (!apply) return transcript;
  const next = clone(transcript);
  apply(next, r);
  return next;
};

export const reduceAll = (records: unknown[]): Transcript => {
  const t: Transcript = { turns: [] };
  for (const record of records) {
    const r = record as Record_;
    const apply = appliers[r.type];
    if (apply) apply(t, r);
  }
  return t;
};
