import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeDirectory } from './directory.ts';

describe('directory report', () => {
  it('separates a missing path, a file, and a real directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccdesk-dir-'));
    const file = join(dir, 'a.txt');
    await writeFile(file, 'x');
    const real = join(dir, 'sub');
    await mkdir(real);

    expect(await describeDirectory(join(dir, 'nope'))).toEqual({ path: join(dir, 'nope'), exists: false, isDirectory: false, sessions: 0 });
    expect(await describeDirectory(file)).toEqual({ path: file, exists: true, isDirectory: false, sessions: 0 });
    const found = await describeDirectory(real);
    expect(found.exists).toBe(true);
    expect(found.isDirectory).toBe(true);
    expect(found.sessions).toBe(0);
  });
});
