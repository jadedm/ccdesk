// Full-text search over transcripts. Streams each JSONL file once, tracks the user turn it
// is in, and reports the first hit per session with a snippet. Titles and first prompts from
// the listing are matched too, so a session found by name shows up even when its body does not.

import { createReadStream } from 'node:fs';
import type { SearchHit, SessionSummary } from '../../shared/protocol.ts';
import { bashInput, machineryTag, startsTurn } from '../../shared/turns.ts';

type Hit = { turn: number; snippet: string };

type Record_ = { type?: string; isMeta?: boolean; parent_tool_use_id?: string | null; message?: { content?: unknown } };

const textOf = (content: unknown): string[] => {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((c): c is { type: 'text'; text: string } => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text);
};

/** How many turns this record opens. The reducer places one user block per text part, so a
 * record with two prompts opens two turns. */
const turnsOpened = (record: Record_): number => {
  if (record.type !== 'user') return 0;
  return textOf(record.message?.content).filter((t) => startsTurn(t, record.isMeta === true)).length;
};

/** True when the record puts anything in the transcript. The reducer opens a turn for the
 * first such block even when no prompt came before it. */
const rendersSomething = (record: Record_): boolean => {
  if (record.type === 'assistant') return textOf(record.message?.content).length > 0 || hasNonText(record);
  return searchable(record).length > 0 || machineryOf(record).length > 0;
};

const hasNonText = (record: Record_): boolean => {
  const content = record.message?.content;
  return Array.isArray(content) && content.some((c) => c?.type === 'thinking' || c?.type === 'tool_use');
};

const machineryOf = (record: Record_): string[] =>
  record.type === 'user' && !record.isMeta ? textOf(record.message?.content).filter((t) => machineryTag(t)) : [];

/** The text a reader can actually see in this record, in the form they see it. */
const searchable = (record: Record_): string[] => {
  if (record.isMeta) return [];
  const texts = textOf(record.message?.content);
  if (record.type !== 'user') return texts;
  return texts.map((t) => bashInput(t) ?? (machineryTag(t) ? '' : t)).filter((t) => t !== '');
};

export const snippetAround = (text: string, index: number, radius = 60): string => {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  const piece = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${piece}${end < text.length ? '…' : ''}`;
};

/** First hit in a transcript, or null. Reads the whole file only until the hit. */
export const searchFile = async (file: string, query: string): Promise<Hit | null> => {
  const needle = query.toLowerCase();
  const turns: Turns = { count: 0 };
  let remainder = '';
  const stream = createReadStream(file, { encoding: 'utf8' });
  try {
    for await (const chunk of stream) {
      const lines = (remainder + (chunk as string)).split('\n');
      remainder = lines.pop() ?? '';
      for (const line of lines) {
        const hit = searchLine(line, needle, turns);
        if (hit) return hit;
      }
    }
    return searchLine(remainder, needle, turns);
  } finally {
    stream.destroy();
  }
};

type Turns = { count: number };

const searchLine = (line: string, needle: string, turns: Turns): Hit | null => {
  if (line === '') return null;
  let record: Record_;
  try {
    record = JSON.parse(line) as Record_;
  } catch {
    return null;
  }
  if (record.type !== 'user' && record.type !== 'assistant') return null;
  // Subagent traffic never reaches the rendered transcript, so it is neither counted nor searched.
  if (typeof record.parent_tool_use_id === 'string' && record.parent_tool_use_id !== '') return null;
  const opened = turnsOpened(record);
  // A transcript that starts with a reply still has a first turn to hold it.
  if (opened === 0 && turns.count === 0 && rendersSomething(record)) turns.count = 1;
  turns.count += opened;
  for (const text of searchable(record)) {
    const index = text.toLowerCase().indexOf(needle);
    if (index !== -1) return { turn: Math.max(1, turns.count), snippet: snippetAround(text, index) };
  }
  return null;
};

/** A title or first-prompt match counts as turn 1 with the matching field as the snippet. */
export const matchSummary = (summary: SessionSummary, query: string): Hit | null => {
  const needle = query.toLowerCase();
  for (const field of [summary.customTitle, summary.summary, summary.firstPrompt]) {
    const index = (field ?? '').toLowerCase().indexOf(needle);
    if (index !== -1) return { turn: 1, snippet: snippetAround(field ?? '', index) };
  }
  return null;
};

export const MAX_RESULTS = 50;

export const sortHits = (hits: SearchHit[]): SearchHit[] => [...hits].sort((a, b) => b.lastModified - a.lastModified);
