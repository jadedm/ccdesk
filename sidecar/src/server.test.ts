import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startServer, type RunningServer } from './server.ts';

let server: RunningServer;
let base: string;
let emptyDir: string;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccdesk-server-'));
  emptyDir = await mkdtemp(join(tmpdir(), 'ccdesk-empty-'));
  server = await startServer({ indexPath: join(dir, 'index.json'), sdkVersion: 'test' });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
});

const call = (method: string, path: string, body?: unknown, token = server.token) =>
  fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('sidecar http', () => {
  it('answers health with the token and 401 without it', async () => {
    const ok = await call('GET', '/health');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, sdkVersion: 'test' });
    expect((await call('GET', '/health', undefined, 'wrong')).status).toBe(401);
    expect((await fetch(base + '/health')).status).toBe(401);
  });

  it('answers a CORS preflight without a token and stamps every response with allow-origin', async () => {
    const preflight = await fetch(base + '/index', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:1420', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization');
    const real = await call('GET', '/health');
    expect(real.headers.get('access-control-allow-origin')).toBe('*');
    const denied = await fetch(base + '/health');
    expect(denied.status).toBe(401);
    expect(denied.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('uses a fixed token and port when configured, for dev and smoke runs', async () => {
    const fixed = await startServer({ indexPath: join(emptyDir, 'i.json'), sdkVersion: 'test', token: 'fixed-token' });
    const res = await fetch(`http://127.0.0.1:${fixed.port}/health`, { headers: { authorization: 'Bearer fixed-token' } });
    expect(res.status).toBe(200);
    await fixed.close();
  });

  it('reports a session that cannot start as an error event instead of dying', async () => {
    const broken = await startServer({ indexPath: join(emptyDir, 'b.json'), sdkVersion: 'test', claudeBinary: '/nonexistent/claude' });
    const messages = await new Promise<string[]>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${broken.port}/ws?token=${broken.token}`);
      const seen: string[] = [];
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'start', key: 'x', cwd: emptyDir }));
        ws.send(JSON.stringify({ type: 'prompt', key: 'x', text: 'hi' }));
      });
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString()) as { type: string; message?: string; reason?: string };
        seen.push(`${m.type}:${m.message ?? m.reason ?? ''}`);
        // Whether the start fails synchronously or on spawn decides if the queued prompt is
        // answered, and in which order; settle shortly after the end event either way.
        if (m.type === 'ended') setTimeout(() => { ws.close(); resolve(seen); }, 300);
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error(`incomplete, saw ${seen.join(' | ')}`)), 30_000);
    });
    expect(messages.some((m) => m.startsWith('error:') && !m.includes('no such live session'))).toBe(true);
    expect(messages).toContain('ended:error');
    const health = await fetch(`http://127.0.0.1:${broken.port}/health`, { headers: { authorization: `Bearer ${broken.token}` } });
    expect(health.status).toBe(200);
    await broken.close();
  });

  it('accepts the token as a query parameter on the upgrade only', async () => {
    expect((await fetch(`${base}/health?token=${server.token}`)).status).toBe(401);
  });

  it('survives malformed frames and bad start requests, answering each with an error', async () => {
    const replies = await new Promise<string[]>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`);
      const seen: string[] = [];
      ws.on('open', () => {
        ws.send('null');
        ws.send('{not json');
        ws.send(JSON.stringify({ type: 'start', key: 'bad', cwd: 'relative' }));
        ws.send(JSON.stringify({ type: 'start', key: 'bad2', cwd: emptyDir, permissionMode: 'god' }));
        ws.send(JSON.stringify({ type: 'nope', key: 'k' }));
      });
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString()) as { type: string; key: string; message: string };
        seen.push(`${m.key}:${m.message}`);
        if (seen.length === 5) {
          ws.close();
          resolve(seen);
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error(`saw ${seen.join(' | ')}`)), 10_000);
    });
    expect(replies[0]).toContain('malformed frame');
    expect(replies[1]).toContain('malformed frame');
    expect(replies[2]).toBe('bad:absolute cwd required');
    expect(replies[3]).toBe('bad2:bad_permission_mode');
    expect(replies[4]).toContain('unknown message type');
    expect((await call('GET', '/health')).status).toBe(200);
  });

  it('closes promptly with a websocket and a keep-alive connection still open', async () => {
    const own = await startServer({ indexPath: join(emptyDir, 'c.json'), sdkVersion: 'test' });
    const ws = new WebSocket(`ws://127.0.0.1:${own.port}/ws?token=${own.token}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    await fetch(`http://127.0.0.1:${own.port}/health`, { headers: { authorization: `Bearer ${own.token}`, connection: 'keep-alive' } });
    const closed = new Promise<boolean>((resolve) => {
      ws.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 2_000);
    });
    const started = Date.now();
    await own.close();
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(await closed).toBe(true);
  });

  it('rejects a websocket upgrade without the token', async () => {
    const outcome = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      ws.on('open', () => resolve('open'));
      ws.on('error', (e) => resolve(e.message));
    });
    expect(outcome).toContain('401');
  });

  it('creates workspace and folder, files a session, and reports conflicts and validation', async () => {
    const ws = await (await call('POST', '/workspaces', { name: 'W', cwd: emptyDir })).json();
    const folder = await (await call('POST', `/workspaces/${ws.id}/folders`, { name: 'F' })).json();
    const withDir = await (await call('POST', `/workspaces/${ws.id}/folders`, { name: 'G', cwd: emptyDir })).json();
    expect(withDir.cwd).toBe(emptyDir);
    expect((await call('POST', `/folders/${folder.id}/sessions`, { sessionId: 's1', cwd: emptyDir })).status).toBe(200);
    const dup = await call('POST', `/folders/${folder.id}/sessions`, { sessionId: 's1', cwd: emptyDir });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toBe('session_already_filed');
    const bad = await call('POST', '/workspaces', { name: '' });
    expect(bad.status).toBe(400);
    expect((await call('POST', '/workspaces/nope/folders', { name: 'x' })).status).toBe(404);
    const index = await (await call('GET', '/index')).json();
    expect(index.workspaces[0].folders[0].sessions).toEqual([{ sessionId: 's1', cwd: emptyDir }]);
    expect(index.workspaces[0].folders[1].cwd).toBe(emptyDir);
  });

  it('renames, moves, unfiles and deletes through the routes', async () => {
    const ws = await (await call('POST', '/workspaces', { name: 'Org', cwd: emptyDir })).json();
    const a = await (await call('POST', `/workspaces/${ws.id}/folders`, { name: 'a' })).json();
    const b = await (await call('POST', `/workspaces/${ws.id}/folders`, { name: 'b' })).json();
    await call('POST', `/folders/${a.id}/sessions`, { sessionId: 'org-1', cwd: emptyDir });
    expect((await (await call('PATCH', `/workspaces/${ws.id}`, { name: 'Organised' })).json()).name).toBe('Organised');
    expect((await (await call('PATCH', `/folders/${a.id}`, { name: 'alpha' })).json()).name).toBe('alpha');
    expect((await (await call('PATCH', `/folders/${a.id}/sessions/org-1`, { folderId: b.id })).json()).sessions).toEqual([{ sessionId: 'org-1', cwd: emptyDir }]);
    expect((await call('DELETE', `/folders/${b.id}/sessions/org-1`)).status).toBe(200);
    expect((await call('DELETE', `/folders/${b.id}/sessions/org-1`)).status).toBe(404);
    expect((await call('DELETE', `/folders/${a.id}`)).status).toBe(200);
    expect((await call('DELETE', `/workspaces/${ws.id}`)).status).toBe(200);
    expect((await call('DELETE', `/workspaces/${ws.id}`)).status).toBe(404);
  });

  it('search rejects short queries and scans the index directories', async () => {
    expect((await call('GET', '/search?q=a')).status).toBe(400);
    const res = await call('GET', '/search?q=zzqq');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[]; scanned: number; truncated: boolean };
    expect(body.results).toEqual([]);
    expect(body.truncated).toBe(false);
  });

  it('returns 400 for malformed json and 404 for unknown routes', async () => {
    const res = await fetch(base + '/workspaces', {
      method: 'POST',
      headers: { authorization: `Bearer ${server.token}` },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect((await call('GET', '/nope')).status).toBe(404);
  });

  it('lists no sessions for a directory that has none and requires cwd', async () => {
    const none = await call('GET', `/sessions?cwd=${encodeURIComponent(emptyDir)}`);
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual([]);
    expect((await call('GET', '/sessions')).status).toBe(400);
  });
});
