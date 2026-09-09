import { describe, expect, it } from 'vitest';
import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
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
  line({ type: 'assistant', message: { role: 'assistant', content: [] } }),
  line({ type: 'ai-title', aiTitle: 'x' }),
  line({ type: 'last-prompt' }),
].join('\n') + '\n';

describe('session metadata', () => {
  it('counts user and assistant records and takes the first model, caching by mtime', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccdesk-meta-'));
    const file = join(dir, 's.jsonl');
    await writeFile(file, fixture);
    const cache = new SessionMetaCache();
    expect(await cache.read(file)).toEqual({ messages: 7, model: 'claude-test-1' });
    expect(cache.scans).toBe(1);
    expect(await cache.read(file)).toEqual({ messages: 7, model: 'claude-test-1' });
    expect(cache.scans).toBe(1);
    await writeFile(file, fixture + line({ type: 'user', message: { role: 'user', content: 'four' } }) + '\n');
    await utimes(file, new Date(), new Date(Date.now() + 5000));
    expect((await cache.read(file))?.messages).toBe(8);
    expect(cache.scans).toBe(2);
    expect(await cache.read(join(dir, 'missing.jsonl'))).toBeNull();
  });

  it('derives the CLI project slug and session file path', () => {
    expect(projectSlug('/Users/x/Documents/work/manishj/test')).toBe('-Users-x-Documents-work-manishj-test');
    expect(projectSlug('/a/.claude/worktrees/b')).toBe('-a--claude-worktrees-b');
    expect(sessionFile('/w', 'abc', '/home/u')).toBe('/home/u/.claude/projects/-w/abc.jsonl');
  });
});
