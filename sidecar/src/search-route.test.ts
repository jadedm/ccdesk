// The search route end to end: a real index, real transcripts in a real CLI store layout, and
// a query that must find one of them. A handler returning a constant fails every assertion.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectSlug } from './session-meta.ts';
import { startServer, type RunningServer } from './server.ts';

let server: RunningServer;
let home: string;
let projectA: string;
let projectB: string;

const line = (o: unknown) => JSON.stringify(o);
const transcript = (prompt: string, reply: string) =>
  [line({ type: 'user', message: { role: 'user', content: prompt } }), line({ type: 'assistant', message: { role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: reply }] } })].join('\n') + '\n';

const call = (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' } });
const post = (path: string, body: unknown) =>
  fetch(`http://127.0.0.1:${server.port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'ccdesk-home-'));
  projectA = await mkdtemp(join(tmpdir(), 'ccdesk-projA-'));
  projectB = await mkdtemp(join(tmpdir(), 'ccdesk-projB-'));
  for (const [dir, files] of [
    [projectA, [['aaaaaaaa-0000-4000-8000-00000000000a.jsonl', transcript('tell me about marmalade', 'Marmalade is jam.')]]],
    [projectB, [['bbbbbbbb-0000-4000-8000-00000000000b.jsonl', transcript('unrelated question', 'unrelated answer')]]],
  ] as Array<[string, Array<[string, string]>]>) {
    const store = join(home, '.claude', 'projects', projectSlug(realpathSync(dir)));
    await mkdir(store, { recursive: true });
    for (const [name, body] of files) await writeFile(join(store, name), body);
  }
  process.env.HOME = home;
  server = await startServer({ indexPath: join(home, 'index.json'), sdkVersion: 'test' });
  const ws = (await (await post('/workspaces', { name: 'A', cwd: projectA })).json()) as { id: string };
  const folder = (await (await post(`/workspaces/${ws.id}/folders`, { name: 'b', cwd: projectB })).json()) as { id: string };
  expect(folder.id).toBeTruthy();
});

afterAll(async () => {
  await server.close();
});

describe('search route', () => {
  it('finds a hit in a workspace directory and attributes it to that workspace', async () => {
    const body = (await (await call('/search?q=marmalade')).json()) as { results: Array<{ sessionId: string; workspaceId: string; turn: number; snippet: string; cwd: string }>; scanned: number; skipped: number; truncated: boolean };
    expect(body.results).toHaveLength(1);
    expect(body.results[0].sessionId).toBe('aaaaaaaa-0000-4000-8000-00000000000a');
    expect(body.results[0].turn).toBe(1);
    expect(body.results[0].snippet).toContain('marmalade');
    expect(body.results[0].workspaceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.scanned).toBeGreaterThanOrEqual(2);
    expect(body.skipped).toBe(0);
    expect(body.truncated).toBe(false);
  });

  it('scans the folder directory too, and reports nothing for a miss', async () => {
    const hit = (await (await call('/search?q=unrelated')).json()) as { results: Array<{ sessionId: string }> };
    expect(hit.results.map((r) => r.sessionId)).toEqual(['bbbbbbbb-0000-4000-8000-00000000000b']);
    const miss = (await (await call('/search?q=zzqqzz')).json()) as { results: unknown[]; scanned: number };
    expect(miss.results).toEqual([]);
    expect(miss.scanned).toBeGreaterThanOrEqual(2);
  });
});
