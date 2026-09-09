// Boots the built bundle from a bare directory, the way the packaged app runs it: no
// node_modules beside it and no CLI binary configured. The sidecar must report the failed
// session over the socket and stay alive, not die on an uncaught throw.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

let child: ChildProcess;
let banner: { port: number; token: string };

beforeAll(async () => {
  execSync('node build.mjs', { cwd: join(import.meta.dirname, '..'), stdio: 'ignore' });
  const dir = mkdtempSync(join(tmpdir(), 'ccdesk-bundle-'));
  copyFileSync(join(import.meta.dirname, '..', 'dist', 'sidecar.cjs'), join(dir, 'sidecar.cjs'));
  // No CCDESK_CLAUDE_BIN at all: the SDK then looks for its platform package, which a bare
  // directory does not have. An empty value would make it fall back to `claude` on PATH.
  // A scrubbed environment, as a GUI launch would have it: no PATH entry for claude, no
  // CCDESK_CLAUDE_BIN, no inherited Claude Code variables.
  const env = { HOME: dir, PATH: '/usr/bin:/bin', CCDESK_INDEX: join(dir, 'index.json') };
  child = spawn(process.execPath, ['sidecar.cjs'], {
    cwd: dir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  banner = await new Promise((resolve, reject) => {
    let buffer = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const line = buffer.split('\n')[0];
      if (buffer.includes('\n')) resolve(JSON.parse(line));
    });
    child.on('exit', (code) => reject(new Error(`sidecar exited early with ${code}`)));
    setTimeout(() => reject(new Error('no banner')), 15_000);
  });
});

afterAll(() => {
  child?.kill();
});

describe('bundled sidecar in a bare directory', () => {
  it('reports a session that cannot start and keeps serving', async () => {
    const seen = await new Promise<string[]>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${banner.port}/ws?token=${banner.token}`);
      const messages: string[] = [];
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'start', key: 'x', cwd: tmpdir() }));
        ws.send(JSON.stringify({ type: 'prompt', key: 'x', text: 'hi' }));
      });
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString()) as { type: string; message?: string; reason?: string };
        messages.push(`${m.type}:${m.message ?? m.reason ?? ''}`);
        if (messages.includes('ended:error') && messages.length >= 3) {
          ws.close();
          resolve(messages);
        }
      });
      ws.on('close', () => resolve(messages));
      ws.on('error', (e) => reject(e));
      setTimeout(() => reject(new Error(`timeout, saw ${messages.join(' | ')}`)), 30_000);
    });
    expect(seen.some((m) => m.startsWith('error:') && m.includes('binary'))).toBe(true);
    expect(seen).toContain('ended:error');
    // The prompt queued behind the failed start is answered, not swallowed.
    expect(seen).toContain('error:no such live session');
    expect(child.exitCode).toBeNull();
    const health = await fetch(`http://127.0.0.1:${banner.port}/health`, { headers: { authorization: `Bearer ${banner.token}` } });
    expect(health.status).toBe(200);
  });
});
