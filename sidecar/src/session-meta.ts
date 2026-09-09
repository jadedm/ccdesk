// Per-session metadata the SDK listing does not carry: message count and model. Each
// transcript is scanned once and the result cached by path and mtime, so a listing of
// thirty sessions costs one pass over each file the first time and a stat afterwards.

import { createReadStream, realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export type SessionMeta = { messages: number; model: string | null };

/** The CLI stores a project's sessions under a slug of its resolved directory path:
 * `/var/folders/...` on macOS is a symlink and the store lives under `/private/var/...`. */
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

const scan = async (file: string): Promise<SessionMeta> => {
  let messages = 0;
  let model: string | null = null;
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line === '') continue;
    let record: { type?: string; message?: { model?: string } };
    try {
      record = JSON.parse(line) as typeof record;
    } catch {
      continue;
    }
    if (record.type !== 'user' && record.type !== 'assistant') continue;
    messages++;
    if (!model && record.type === 'assistant' && record.message?.model) model = record.message.model;
  }
  return { messages, model };
};

export class SessionMetaCache {
  private readonly cache = new Map<string, { mtimeMs: number; meta: SessionMeta }>();
  /** How many files were actually read; tests use it to prove the cache. */
  scans = 0;

  async read(file: string): Promise<SessionMeta | null> {
    const info = await stat(file).catch(() => null);
    if (!info) return null;
    const cached = this.cache.get(file);
    if (cached && cached.mtimeMs === info.mtimeMs) return cached.meta;
    this.scans++;
    const meta = await scan(file);
    this.cache.set(file, { mtimeMs: info.mtimeMs, meta });
    return meta;
  }
}
