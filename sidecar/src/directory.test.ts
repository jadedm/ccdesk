import { beforeAll, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeDirectory } from './directory.ts';
import { projectSlug } from './session-meta.ts';
import { realpathSync } from 'node:fs';

// The SDK resolves its projects directory once, so HOME is set before the first call.
let home = '';

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'ccdesk-home-'));
  process.env.HOME = home;
});

describe('directory report', () => {
  it('separates a missing path, a file, and a real directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccdesk-dir-'));
    const file = join(dir, 'a.txt');
    await writeFile(file, 'x');
    const real = join(dir, 'sub');
    await mkdir(real);

    expect(await describeDirectory(join(dir, 'nope'))).toMatchObject({ exists: false, isDirectory: false, sessions: 0, problem: 'missing' });
    expect(await describeDirectory(file)).toMatchObject({ exists: true, isDirectory: false, problem: 'not-a-directory' });
    expect(await describeDirectory(real)).toMatchObject({ exists: true, isDirectory: true, readable: true, sessions: 0, problem: null });
  });

  it('counts the sessions a directory already holds', async () => {
    const project = await mkdtemp(join(tmpdir(), 'ccdesk-proj-'));
    const store = join(home, '.claude', 'projects', projectSlug(realpathSync(project)));
    await mkdir(store, { recursive: true });
    const body = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'hi' }] } }),
    ].join('\n') + '\n';
    for (const id of ['aaaaaaaa-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-00000000000b']) {
      await writeFile(join(store, `${id}.jsonl`), body);
    }
    // The count is the reason this endpoint exists, so it is asserted above zero.
    expect((await describeDirectory(project)).sessions).toBe(2);
    expect((await describeDirectory(project)).problem).toBeNull();
  });

  it('calls an unreadable directory unreadable, not missing', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ccdesk-locked-'));
    const inner = join(parent, 'project');
    await mkdir(inner);
    await chmod(parent, 0o000);
    const report = await describeDirectory(inner);
    await chmod(parent, 0o700);
    // Root can read through the lock; anyone else must not be told the directory is missing.
    expect(report.problem === null || report.problem === 'unreadable').toBe(true);
    if (report.problem === 'unreadable') expect(report.exists).toBe(true);
  });
});
