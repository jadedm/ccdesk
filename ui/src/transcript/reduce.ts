// Reduces raw records into the block model. Pure: (transcript, record) -> transcript.
// Handles two record shapes with one code path:
//   history: { type: 'user' | 'assistant' | 'system', message, uuid }  (the SDK's getSessionMessages)
//   live:    SDK messages, the same shapes plus 'stream_event' and 'result'.
//
// Immutability: the previous transcript is never mutated. Turn arrays are copied on every
// record and a block is copied right before it is changed (copy on write), so a delta costs
// O(turns), not O(blocks). React strict mode runs reducers twice on the same input, which
// turned a shared-block mutation into a duplicated final message once.

import { countLines, summarise } from './summaries.ts';
import type { Block, Transcript, Turn } from './blocks.ts';

type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content?: string | Array<{ type: string; text?: string }>; is_error?: boolean };
type TextPart = { type: 'text'; text: string };
type ThinkingPart = { type: 'thinking'; thinking: string };
type ToolUsePart = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
type ContentBlock = TextPart | ThinkingPart | ToolUsePart | ToolResultBlock | { type: string };

type Record_ = {
  type: string;
  subtype?: string;
  uuid?: string;
  timestamp?: string;
  isMeta?: boolean;
  parent_tool_use_id?: string | null;
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
  | { type: string };

type ToolBlock = Extract<Block, { kind: 'tool' }>;
type StreamingKind = 'text' | 'thinking' | 'tool';

let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${++counter}`;

const clone = (t: Transcript): Transcript => ({ ...t, turns: t.turns.map((turn) => ({ ...turn, blocks: [...turn.blocks] })) });

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

const newTurn = (t: Transcript, block: Block): void => {
  t.turns.push({ id: nextId('turn'), blocks: [block] });
};

/** Replace the block at an index with a changed copy. The only way a block is ever changed. */
const patch = <B extends Block>(turn: Turn, index: number, change: Partial<B>): B => {
  const next = { ...(turn.blocks[index] as B), ...change };
  turn.blocks[index] = next;
  return next;
};

const findLast = (t: Transcript, test: (b: Block) => boolean): { turn: Turn; index: number } | null => {
  for (let ti = t.turns.length - 1; ti >= 0; ti--) {
    const turn = t.turns[ti];
    for (let bi = turn.blocks.length - 1; bi >= 0; bi--) if (test(turn.blocks[bi])) return { turn, index: bi };
  }
  return null;
};

const findTool = (t: Transcript, id: string) => findLast(t, (b) => b.kind === 'tool' && b.id === id);

const findOpen = (t: Transcript, kind: StreamingKind) => {
  const turn = currentTurn(t);
  for (let bi = turn.blocks.length - 1; bi >= 0; bi--) {
    const b = turn.blocks[bi];
    if (b.kind === kind && 'streaming' in b && b.streaming) return { turn, index: bi };
  }
  return null;
};

// Harness-injected user turns are machinery the CLI put in the conversation, not something
// the user typed. They become folded system blocks tagged with their kind, so the reader
// can open them when the question is "what did the harness tell Claude here".
const systemTag = /^<(system-reminder|task-notification|local-command-caveat|local-command-stdout|local-command-stderr|command-message|command-args|command-contents|command-stdout|command-stderr|user-prompt-submit-hook|bash-stdout|bash-stderr)\b/;

/** Remove only the wrapper the harness added; whatever it quoted inside stays as written. */
const unwrap = (text: string, tag: string): string =>
  text.replace(new RegExp(`^<${tag}\\b[^>]*>`), '').replace(new RegExp(`</${tag}>\\s*$`), '').trim();

const userTextToBlock = (text: string, at?: string): Block | null => {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const command = trimmed.match(/^<command-name>([^<]+)<\/command-name>/);
  if (command) return { kind: 'note', id: nextId('note'), text: `ran ${command[1]}`, tone: 'info' };
  const bash = trimmed.match(/^<bash-input>([\s\S]*?)<\/bash-input>/);
  if (bash) return { kind: 'user', id: nextId('user'), text: `! ${bash[1].trim()}`, at };
  const system = trimmed.match(systemTag);
  if (system) return { kind: 'system', id: nextId('system'), tag: system[1], text: unwrap(trimmed, system[1]) };
  if (trimmed.startsWith('[Request interrupted')) return { kind: 'note', id: nextId('note'), text: 'interrupted by user', tone: 'info' };
  return { kind: 'user', id: nextId('user'), text: trimmed, at };
};

const placeUserBlock = (t: Transcript, block: Block | null): void => {
  if (!block) return;
  if (block.kind === 'user') newTurn(t, block);
  else append(t, block);
};

/** The turn remembers when its reply began; the renderer labels the first visible reply block. */
const stampReply = (t: Transcript, at: string | undefined): void => {
  if (!at) return;
  const turn = currentTurn(t);
  if (turn.replyAt) return;
  const hasReply = turn.blocks.some((b) => b.kind === 'text' || b.kind === 'thinking' || b.kind === 'tool');
  if (hasReply) turn.replyAt = at;
};

const resultText = (content: ToolResultBlock): string => {
  if (typeof content.content === 'string') return content.content;
  if (!Array.isArray(content.content)) return '';
  return content.content.map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`)).join('\n');
};

const applyToolResult = (t: Transcript, part: ToolResultBlock): void => {
  const found = findTool(t, part.tool_use_id);
  if (!found) {
    append(t, { kind: 'note', id: nextId('note'), text: `result for unknown tool ${part.tool_use_id}`, tone: 'info' });
    return;
  }
  const text = resultText(part);
  patch<ToolBlock>(found.turn, found.index, { result: { text, isError: part.is_error === true, lines: countLines(text) }, streaming: false });
};

type PartHandler = (t: Transcript, part: ContentBlock, record: Record_) => void;

const userParts: Record<string, PartHandler> = {
  tool_result: (t, part) => applyToolResult(t, part as ToolResultBlock),
  text: (t, part, record) => {
    if (record.isMeta) return;
    placeUserBlock(t, userTextToBlock((part as TextPart).text, record.timestamp));
  },
  image: (t) => append(t, { kind: 'note', id: nextId('note'), text: 'attached image', tone: 'info' }),
  document: (t) => append(t, { kind: 'note', id: nextId('note'), text: 'attached document', tone: 'info' }),
};

const applyUser = (t: Transcript, record: Record_): void => {
  const content = record.message?.content;
  if (typeof content === 'string' && record.isMeta) return;
  if (typeof content === 'string') {
    placeUserBlock(t, userTextToBlock(content, record.timestamp));
    return;
  }
  if (!Array.isArray(content)) return;
  for (const part of content) userParts[part.type]?.(t, part, record);
};

/** Final text for a streamed block: replace the open block, or add one if nothing streamed. */
const settleStreamed = (t: Transcript, kind: 'text' | 'thinking', text: string): void => {
  const open = findOpen(t, kind);
  if (open) {
    patch(open.turn, open.index, { text, streaming: false });
    return;
  }
  if (text.trim() === '') return;
  append(t, { kind, id: nextId(kind), text, streaming: false });
};

const assistantParts: Record<string, PartHandler> = {
  text: (t, part) => settleStreamed(t, 'text', (part as TextPart).text),
  thinking: (t, part) => settleStreamed(t, 'thinking', (part as ThinkingPart).thinking),
  tool_use: (t, part) => {
    const use = part as ToolUsePart;
    const summary = summarise(use.name, use.input);
    const existing = findTool(t, use.id);
    if (existing) {
      patch<ToolBlock>(existing.turn, existing.index, { input: use.input, summary });
      return;
    }
    append(t, { kind: 'tool', id: use.id, name: use.name, input: use.input, summary, streaming: true });
  },
};

const applyAssistant = (t: Transcript, record: Record_): void => {
  const content = record.message?.content;
  if (record.message?.model && !t.model) t.model = record.message.model;
  if (Array.isArray(content)) for (const part of content) assistantParts[part.type]?.(t, part, record);
  stampReply(t, record.timestamp);
  if (record.error) append(t, { kind: 'note', id: nextId('note'), text: `api error: ${record.error}`, tone: 'error' });
};

const streamStarts: Record<string, (t: Transcript, cb: ContentBlock) => void> = {
  text: (t) => append(t, { kind: 'text', id: nextId('text'), text: '', streaming: true }),
  thinking: (t) => append(t, { kind: 'thinking', id: nextId('thinking'), text: '', streaming: true }),
  tool_use: (t, cb) => {
    const use = cb as ToolUsePart;
    append(t, { kind: 'tool', id: use.id, name: use.name, input: {}, summary: use.name, streaming: true });
  },
};

const appendDelta = (t: Transcript, kind: 'text' | 'thinking', piece: string): void => {
  const open = findOpen(t, kind);
  if (!open) return;
  const current = open.turn.blocks[open.index] as Extract<Block, { kind: 'text' | 'thinking' }>;
  patch(open.turn, open.index, { text: current.text + piece });
};

const streamDeltas: Record<string, (t: Transcript, delta: { text?: string; thinking?: string }) => void> = {
  text_delta: (t, delta) => appendDelta(t, 'text', delta.text ?? ''),
  thinking_delta: (t, delta) => appendDelta(t, 'thinking', delta.thinking ?? ''),
};

const applyStream = (t: Transcript, record: Record_): void => {
  const event = record.event;
  if (!event) return;
  if (event.type === 'content_block_start' && 'content_block' in event) {
    streamStarts[event.content_block.type]?.(t, event.content_block);
    // A live reply has no record timestamp; the moment it started is the label.
    stampReply(t, record.timestamp ?? new Date().toISOString());
  }
  if (event.type === 'content_block_delta' && 'delta' in event) streamDeltas[event.delta.type]?.(t, event.delta);
};

const applySystem = (t: Transcript, record: Record_): void => {
  if (record.subtype !== 'init') return;
  t.model = record.model ?? t.model;
  t.version = record.claude_code_version ?? t.version;
};

/** Close every open block. A turn has ended, so nothing is still streaming. */
const closeStreaming = (t: Transcript): void => {
  for (const turn of t.turns) {
    turn.blocks.forEach((b, i) => {
      if ('streaming' in b && b.streaming) patch(turn, i, { streaming: false });
    });
  }
};

const applyResult = (t: Transcript, record: Record_): void => {
  closeStreaming(t);
  if (!record.is_error) return;
  append(t, { kind: 'note', id: nextId('note'), text: record.result ?? 'turn failed', tone: 'error' });
};

const appliers: Record<string, (t: Transcript, r: Record_) => void> = {
  user: applyUser,
  assistant: applyAssistant,
  system: applySystem,
  result: applyResult,
  stream_event: applyStream,
};

// Subagent traffic carries parent_tool_use_id. The session store drops it from history, so
// the live view drops it too and both render the same conversation.
const isSubagent = (r: Record_): boolean => typeof r.parent_tool_use_id === 'string' && r.parent_tool_use_id !== '';

const applyInPlace = (t: Transcript, record: unknown): boolean => {
  const r = record as Record_;
  const apply = appliers[r.type];
  if (!apply || isSubagent(r)) return false;
  apply(t, r);
  return true;
};

export const reduceRecord = (transcript: Transcript, record: unknown): Transcript => {
  const next = clone(transcript);
  return applyInPlace(next, record) ? next : transcript;
};

/** History has no result events, so open blocks are closed once at the end. */
export const reduceAll = (records: unknown[]): Transcript => {
  const t: Transcript = { turns: [] };
  for (const record of records) applyInPlace(t, record);
  closeStreaming(t);
  return t;
};
