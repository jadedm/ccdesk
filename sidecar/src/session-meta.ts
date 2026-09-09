// Per-session metadata the SDK listing does not carry: message count and model. Transcripts
// are append-only, so after the first full pass each file is read only from where the last
// pass stopped. Results are cached by path; concurrent reads of one file share a scan; a
// file that cannot be read yields null for that session and nothing else.

import { createReadStream, realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type SessionMeta = { messages: number; model: string | null };

/** The CLI stores a project's sessions under a slug of its resolved directory path
 * (`/var/folders/...` on macOS is a symlink into `/private/var`). The SDK also truncates
 * slugs over 200 characters with a hash; paths that long are not handled here. */
export const projectSlug = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-');

const resolved = (cwd: string): string => {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
};

export const sessionFile = (cwd: string, sessionId: string, home = homedir()): string =>
  join(home, '.claude', 'projects', projectSlug(resolved(cwd)), `${sessionId}.jsonl`);

type Entry = { mtimeMs: number; size: number; consumed: number; meta: SessionMeta };

const countLine = (line: string, meta: SessionMeta): void => {
  let record: { type?: string; isMeta?: boolean; message?: { model?: string } };
  try {
    record = JSON.parse(line) as typeof record;
  } catch {
    return;
  }
  if (record.type !== 'user' && record.type !== 'assistant') return;
  // Meta user records are attachment placeholders and hook feedback, not conversation.
  if (record.type === 'user' && record.isMeta) return;
  meta.messages++;
  if (!meta.model && record.type === 'assistant' && record.message?.model) meta.model = record.message.model;
};

/** Count complete lines from `start`. A trailing partial line (a write in progress) is left
 * for the next pass, so `consumed` always ends on a newline. */
const scanFrom = async (file: string, start: number, into: SessionMeta): Promise<number> => {
  let remainder = '';
  let consumed = start;
  for await (const chunk of createReadStream(file, { encoding: 'utf8', start })) {
    const text = remainder + (chunk as string);
    const lines = text.split('\n');
    remainder = lines.pop() ?? '';
    for (const line of lines) {
      consumed += Buffer.byteLength(line, 'utf8') + 1;
      if (line !== '') countLine(line, into);
    }
  }
  return consumed;
};

export class SessionMetaCache {
  private readonly cache = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<SessionMeta | null>>();
  /** Bytes actually read; tests use it to prove the cache and the incremental pass. */
  bytesRead = 0;

  read(file: string): Promise<SessionMeta | null> {
    const pending = this.inFlight.get(file);
    if (pending) return pending;
    const run = this.readFresh(file).finally(() => this.inFlight.delete(file));
    this.inFlight.set(file, run);
    return run;
  }

  private async readFresh(file: string): Promise<SessionMeta | null> {
    try {
      const info = await stat(file);
      const cached = this.cache.get(file);
      // Two writes inside one mtime tick leave the mtime unchanged, so the size is part of the key.
      if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.meta;
      // Resume where the last pass stopped when the file only grew; start over otherwise.
      const resume = cached && info.size >= cached.consumed ? cached : null;
      const meta: SessionMeta = resume ? { ...resume.meta } : { messages: 0, model: null };
      const start = resume ? resume.consumed : 0;
      const consumed = await scanFrom(file, start, meta);
      this.bytesRead += consumed - start;
      this.cache.set(file, { mtimeMs: info.mtimeMs, size: info.size, consumed, meta });
      return meta;
    } catch {
      return null;
    }
  }
}
