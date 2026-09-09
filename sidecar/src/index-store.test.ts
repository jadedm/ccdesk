import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexStore } from './index-store.ts';
import { HttpError } from './errors.ts';

const fresh = async (): Promise<{ path: string; store: IndexStore }> => {
  const dir = await mkdtemp(join(tmpdir(), 'ccdesk-index-'));
  const path = join(dir, 'nested', 'index.json');
  const store = new IndexStore(path);
  await store.load();
  return { path, store };
};

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'no error';
  } catch (error) {
    return error instanceof HttpError ? `${error.status} ${error.code}` : String(error);
  }
};

describe('IndexStore', () => {
  it('creates a workspace and a folder and persists them to disk', async () => {
    const { path, store } = await fresh();
    const ws = await store.createWorkspace('Tikiti', '/tmp/tikiti');
    const folder = await store.createFolder(ws.id, 'auth');
    const onDisk = JSON.parse(await readFile(path, 'utf8'));
    expect(onDisk.workspaces[0].name).toBe('Tikiti');
    expect(onDisk.workspaces[0].folders[0].id).toBe(folder.id);

    const reloaded = new IndexStore(path);
    await reloaded.load();
    expect(reloaded.snapshot()).toEqual(store.snapshot());
  });

  it('rejects empty names, relative cwd and unknown ids without touching the index', async () => {
    const { store } = await fresh();
    expect(await codeOf(store.createWorkspace('   ', '/tmp'))).toBe('400 name_required');
    expect(await codeOf(store.createWorkspace('x', 'relative'))).toBe('400 cwd_required');
    expect(await codeOf(store.createFolder('nope', 'x'))).toBe('404 workspace_not_found');
    expect(await codeOf(store.fileSession('nope', 'abc', '/tmp'))).toBe('404 folder_not_found');
    expect(store.snapshot().workspaces).toEqual([]);
  });

  it('files a session once and refuses a second filing of the same id', async () => {
    const { store } = await fresh();
    const ws = await store.createWorkspace('W', '/tmp/w');
    const a = await store.createFolder(ws.id, 'a');
    const b = await store.createFolder(ws.id, 'b');
    await store.fileSession(a.id, 'sess-1', '/tmp/w');
    expect(await codeOf(store.fileSession(b.id, 'sess-1', '/tmp/w'))).toBe('409 session_already_filed');
    expect(await codeOf(store.fileSession(a.id, '', '/tmp/w'))).toBe('400 session_id_required');
    expect(store.snapshot().workspaces[0].folders[0].sessions).toEqual([{ sessionId: 'sess-1', cwd: '/tmp/w' }]);
  });
});
