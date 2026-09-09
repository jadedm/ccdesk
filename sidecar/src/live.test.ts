// Live cases from the ticket's test plan (8 to 14). Real SDK, real API turns.
// Run with CCDESK_LIVE=1 pnpm test.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts';
import { startServer, type RunningServer } from './server.ts';

const live = process.env.CCDESK_LIVE === '1';

class Client {
  readonly received: ServerMessage[] = [];
  private waiters: Array<{ test: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
  constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      this.received.push(message);
      const idx = this.waiters.findIndex((w) => w.test(message));
      if (idx === -1) return;
      const [waiter] = this.waiters.splice(idx, 1);
      waiter.resolve(message);
    });
  }
  static open(url: string): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.on('open', () => resolve(new Client(ws)));
      ws.on('error', reject);
    });
  }
  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message));
  }
  waitFor(test: (m: ServerMessage) => boolean, ms = 90_000): Promise<ServerMessage> {
    const already = this.received.find(test);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      this.waiters.push({ test, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  }
  close(): void {
    this.ws.close();
  }
}

const isResult = (key: string) => (m: ServerMessage) =>
  m.type === 'event' && m.key === key && (m.message as { type: string }).type === 'result';

const assistantText = (client: Client, key: string): string =>
  client.received
    .filter((m): m is Extract<ServerMessage, { type: 'event' }> => m.type === 'event' && m.key === key)
    .map((m) => m.message as { type: string; message?: { content?: Array<{ type: string; text?: string }> } })
    .filter((m) => m.type === 'assistant')
    .flatMap((m) => m.message?.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');

describe.skipIf(!live)('live session over the sidecar', () => {
  let server: RunningServer;
  let cwd: string;
  let client: Client;
  let firstSessionId = '';

  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ccdesk-live-'));
    server = await startServer({ indexPath: join(cwd, 'index.json'), sdkVersion: 'test' });
    client = await Client.open(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`);
  });

  afterAll(async () => {
    client.close();
    await server.close();
  });

  it('8 and 9: starts a session, streams pong, takes a second prompt on the same session', async () => {
    client.send({ type: 'start', key: 'a', cwd, permissionMode: 'default' });
    client.send({ type: 'prompt', key: 'a', text: 'Reply with exactly one word: pong' });
    const started = await client.waitFor((m) => m.type === 'started' && m.key === 'a');
    firstSessionId = (started as { sessionId: string }).sessionId;
    expect(firstSessionId).toMatch(/^[0-9a-f-]{36}$/);
    await client.waitFor(isResult('a'));
    expect(client.received.some((m) => m.type === 'event' && (m.message as { type: string }).type === 'stream_event')).toBe(true);
    expect(assistantText(client, 'a').toLowerCase()).toContain('pong');

    const before = client.received.filter(isResult('a')).length;
    client.send({ type: 'prompt', key: 'a', text: 'Now reply with exactly one word: ping' });
    await client.waitFor((m) => isResult('a')(m) && client.received.filter(isResult('a')).length > before);
    expect(client.received.filter((m) => m.type === 'started').length).toBe(1);
  });

  // The CLI auto-allows read-only commands such as `echo hi` even in default mode, so the
  // case that must ask is a write.
  const writeCommand = 'date > ccdesk-perm.txt && cat ccdesk-perm.txt';

  it('10 and 11: asks permission for a Bash write, honours deny, then allow', async () => {
    client.send({ type: 'start', key: 'b', cwd, permissionMode: 'default' });
    client.send({ type: 'prompt', key: 'b', text: `Use the Bash tool to run exactly: ${writeCommand} . Report the output verbatim.` });
    const ask = await client.waitFor((m) => m.type === 'permission_request' && m.key === 'b');
    expect((ask as { toolName: string }).toolName).toBe('Bash');
    client.send({ type: 'permission', key: 'b', requestId: (ask as { requestId: string }).requestId, behavior: 'deny', message: 'denied by test' });
    await client.waitFor(isResult('b'));
    const denialSeen = client.received.some(
      (m) => m.type === 'event' && m.key === 'b' && JSON.stringify(m.message).includes('denied by test'),
    );
    expect(denialSeen).toBe(true);

    const asksBefore = client.received.filter((m) => m.type === 'permission_request' && m.key === 'b').length;
    const resultsBefore = client.received.filter(isResult('b')).length;
    expect(existsSync(join(cwd, 'ccdesk-perm.txt'))).toBe(false);
    client.send({ type: 'prompt', key: 'b', text: `Try again, once more with the Bash tool: ${writeCommand}` });
    const ask2 = await client.waitFor(
      (m) => m.type === 'permission_request' && m.key === 'b' && client.received.filter((x) => x.type === 'permission_request' && x.key === 'b').length > asksBefore,
    );
    client.send({ type: 'permission', key: 'b', requestId: (ask2 as { requestId: string }).requestId, behavior: 'allow' });
    await client.waitFor((m) => isResult('b')(m) && client.received.filter(isResult('b')).length > resultsBefore);
    expect(existsSync(join(cwd, 'ccdesk-perm.txt'))).toBe(true);
  });

  it('12: interrupt ends the turn and the session still takes a prompt', async () => {
    client.send({ type: 'start', key: 'c', cwd, permissionMode: 'default' });
    client.send({ type: 'prompt', key: 'c', text: 'Count slowly from 1 to 500, one number per line, do not stop early.' });
    await client.waitFor((m) => m.type === 'event' && m.key === 'c' && (m.message as { type: string }).type === 'stream_event');
    client.send({ type: 'interrupt', key: 'c' });
    await client.waitFor(isResult('c'));
    const before = client.received.filter(isResult('c')).length;
    client.send({ type: 'prompt', key: 'c', text: 'Reply with exactly one word: ok' });
    await client.waitFor((m) => isResult('c')(m) && client.received.filter(isResult('c')).length > before);
  });

  it('13: resumes the first session by id and remembers the word', async () => {
    client.send({ type: 'start', key: 'd', cwd, resume: firstSessionId, permissionMode: 'default' });
    client.send({ type: 'prompt', key: 'd', text: 'What was the first single word I asked you to reply with in this conversation? Answer with that word only.' });
    await client.waitFor(isResult('d'));
    expect(assistantText(client, 'd').toLowerCase()).toContain('pong');
  });

  it('14: renames a session and the listing shows the custom title', async () => {
    const headers = { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' };
    const base = `http://127.0.0.1:${server.port}`;
    const patch = await fetch(`${base}/sessions/${firstSessionId}`, { method: 'PATCH', headers, body: JSON.stringify({ cwd, title: 'smoke one' }) });
    expect(patch.status).toBe(200);
    const list = (await (await fetch(`${base}/sessions?cwd=${encodeURIComponent(cwd)}`, { headers })).json()) as Array<{ sessionId: string; customTitle?: string }>;
    expect(list.find((s) => s.sessionId === firstSessionId)?.customTitle).toBe('smoke one');
    const history = (await (await fetch(`${base}/sessions/${firstSessionId}/messages?cwd=${encodeURIComponent(cwd)}`, { headers })).json()) as Array<{ type: string }>;
    expect(history.some((m) => m.type === 'user')).toBe(true);
    expect(history.some((m) => m.type === 'assistant')).toBe(true);
  });
});
