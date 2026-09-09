import { describe, expect, it } from 'vitest';
import { realpathSync } from 'node:fs';
import { appendFile, chmod, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionMetaCache, projectSlug, sessionFile } from './session-meta.ts';

const line = (o: unknown) => JSON.stringify(o);
const fixture = [
  line({ type: 'mode', mode: 'normal' }),
  line({ type: 'user', message: { role: 'user', content: 'one' }, timestamp: 't' }),
  line({ type: 'attachment', attachment: {} }),
  line({ type: 'assistant', message: { role: 'assistant', model: 'claude-test-1', content: [{ type: 'text', text: 'a' }] } }),
  line({ type: 'system', subtype: 'turn_duration' }),
  line({ type: 'user', message: { role: 'user', content: 'two' } }),
  line({ type: 'assistant', message: { role: 'assistant', model: 'claude-test-2', content: [] } }),
  line({ type: 'file-history-snapshot' }),
  line({ type: 'assistant', message: { role: 'assistant', content: [] } }),
  '{not json',
  line({ type: 'user', message: { role: 'user', content: 'three' } }),
  line({ type: 'user', isMeta: true, message: { role: 'user', content: 'Stop hook feedback: x' } }),
  line({ type: 'assistant', message: { role: 'assistant', content: [] } }),
  line({ type: 'ai-title', aiTitle: 'x' }),
  line({ type: 'last-prompt' }),
].join('\n') + '\n';

let bump = 0;
/** Each call moves the mtime further ahead, so two calls never share a filesystem tick. */
const later = async (file: string) => utimes(file, new Date(), new Date(Date.now() + (bump += 5000)));

describe('session metadata', () => {
  it('counts conversation records, takes the first model, and caches by mtime', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccdesk-meta-'));
    const file = join(dir, 's.jsonl');
    await writeFile(file, fixture);
    const cache = new SessionMetaCache();
    expect(await cache.read(file)).toEqual({ messages: 7, model: 'claude-test-1' });
    const firstPass = cache.bytesRead;
    expect(firstPass).toBe(Buffer.byteLength(fixture));
    expect(await cache.read(file)).toEqual({ messages: 7, model: 'claude-test-1' });
    expect(cache.bytesRead).toBe(firstPass);
  });

  it('reads only the appended bytes when a transcript grows, and leaves a partial line for later', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccdesk-meta-'));
    const file = join(dir, 's.jsonl');
    await writeFile(file, fixture);
    const cache = new SessionMetaCache();
    await cache.read(file);
    const before = cache.bytesRead;
    const extra = line({ type: 'user', message: { role: 'user', content: 'four' } }) + '\n';
    await appendFile(file, extra + '{"type":"user","message":{"role":"user","con');
    await later(file);
    expect((await cache.read(file))?.messages).toBe(8);
    expect(cache.bytesRead - before).toBe(Buffer.byteLength(extra));
    // Same mtime as the read above, different size: the size must break the cache.
    await appendFile(file, 'tent":"five"}}\n');
    expect((await cache.read(file))?.messages).toBe(9);
  });

  it('starts over when a file shrinks, shares one scan between concurrent reads, and yields null for an unreadable file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccdesk-meta-'));
    const file = join(dir, 's.jsonl');
    await writeFile(file, fixture);
    const cache = new SessionMetaCache();
    const three = await Promise.all([cache.read(file), cache.read(file), cache.read(file)]);
    expect(three.map((m) => m?.messages)).toEqual([7, 7, 7]);
    expect(cache.bytesRead).toBe(Buffer.byteLength(fixture));
    await writeFile(file, line({ type: 'user', message: { role: 'user', content: 'only' } }) + '\n');
    await later(file);
    expect(await cache.read(file)).toEqual({ messages: 1, model: null });
    expect(await cache.read(join(dir, 'missing.jsonl'))).toBeNull();
    const locked = join(dir, 'locked.jsonl');
    await writeFile(locked, fixture);
    await chmod(locked, 0o000);
    const result = await cache.read(locked);
    await chmod(locked, 0o600);
    // Root reads through permissions; anyone else gets null instead of a thrown listing.
    expect(result === null || result?.messages === 7).toBe(true);
  });

  it('derives the CLI project slug and session file path from the resolved directory', () => {
    expect(projectSlug('/Users/x/Documents/work/manishj/test')).toBe('-Users-x-Documents-work-manishj-test');
    expect(projectSlug('/a/.claude/worktrees/b')).toBe('-a--claude-worktrees-b');
    expect(sessionFile('/w', 'abc', '/home/u')).toBe('/home/u/.claude/projects/-w/abc.jsonl');
    expect(sessionFile('/tmp', 'abc', '/home/u')).toBe(`/home/u/.claude/projects/${projectSlug(realpathSync('/tmp'))}/abc.jsonl`);
  });
});
