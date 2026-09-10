// Full-text search over transcripts. Streams each JSONL file once, tracks the user turn it
// is in, and reports the first hit per session with a snippet. Titles and first prompts from
// the listing are matched too, so a session found by name shows up even when its body does not.

import { createReadStream } from 'node:fs';
import type { SearchHit, SessionSummary } from '../../shared/protocol.ts';

type Hit = { turn: number; snippet: string };

type Record_ = { type?: string; isMeta?: boolean; message?: { content?: unknown } };

const textOf = (content: unknown): string[] => {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((c): c is { type: 'text'; text: string } => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text);
};

/** Harness machinery the transcript folds away: reminders, notifications, command output. */
const isMachinery = (text: string): boolean => text.trimStart().startsWith('<');

const isPrompt = (record: Record_): boolean => {
  if (record.type !== 'user' || record.isMeta) return false;
  const texts = textOf(record.message?.content);
  return texts.length > 0 && !isMachinery(texts[0]);
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
  let turn = 0;
  let remainder = '';
  const stream = createReadStream(file, { encoding: 'utf8' });
  try {
    for await (const chunk of stream) {
      const lines = (remainder + (chunk as string)).split('\n');
      remainder = lines.pop() ?? '';
      for (const line of lines) {
        const hit = searchLine(line, needle, () => turn, () => turn++);
        if (hit) return hit;
      }
    }
    return searchLine(remainder, needle, () => turn, () => turn++);
  } finally {
    stream.destroy();
  }
};

const searchLine = (line: string, needle: string, currentTurn: () => number, nextTurn: () => void): Hit | null => {
  if (line === '') return null;
  let record: Record_;
  try {
    record = JSON.parse(line) as Record_;
  } catch {
    return null;
  }
  if (record.type !== 'user' && record.type !== 'assistant') return null;
  if (isPrompt(record)) nextTurn();
  if (record.type === 'user' && record.isMeta) return null;
  for (const text of textOf(record.message?.content)) {
    if (record.type === 'user' && isMachinery(text)) continue;
    const index = text.toLowerCase().indexOf(needle);
    if (index !== -1) return { turn: Math.max(1, currentTurn()), snippet: snippetAround(text, index) };
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
