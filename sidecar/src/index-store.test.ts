import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
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

  it('moves an unreadable index aside and starts empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccdesk-index-'));
    const path = join(dir, 'index.json');
    await writeFile(path, '{"version": 9, "nope": true}');
    const store = new IndexStore(path);
    const warning = await store.load();
    expect(warning).toContain('moved to');
    expect(store.snapshot()).toEqual({ version: 1, workspaces: [] });
    expect((await readdir(dir)).some((f) => f.startsWith('index.json.unreadable-'))).toBe(true);
    await store.createWorkspace('W', '/tmp');
    expect(JSON.parse(await readFile(path, 'utf8')).workspaces).toHaveLength(1);
  });

  it('stores an optional folder directory and validates it', async () => {
    const { store } = await fresh();
    const ws = await store.createWorkspace('W', '/tmp/w');
    const plain = await store.createFolder(ws.id, 'plain');
    expect(plain.cwd).toBeUndefined();
    const withDir = await store.createFolder(ws.id, 'proj', '/tmp/w/proj');
    expect(withDir.cwd).toBe('/tmp/w/proj');
    expect(await codeOf(store.createFolder(ws.id, 'bad', 'relative'))).toBe('400 bad_cwd');
    const slashed = await store.createFolder(ws.id, 'slashed', '/tmp/w/proj2/');
    expect(slashed.cwd).toBe('/tmp/w/proj2');
    const empty = await store.createFolder(ws.id, 'empty', '');
    expect(empty.cwd).toBeUndefined();
    expect(store.snapshot().workspaces[0].folders.map((f) => f.cwd)).toEqual([undefined, '/tmp/w/proj', '/tmp/w/proj2', undefined]);
  });

  it('loads an index written before folders had directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccdesk-index-'));
    const path = join(dir, 'index.json');
    await writeFile(path, JSON.stringify({ version: 1, workspaces: [{ id: 'w', name: 'W', cwd: '/tmp', folders: [{ id: 'f', name: 'F', sessions: [] }] }] }));
    const store = new IndexStore(path);
    expect(await store.load()).toBeNull();
    expect(store.snapshot().workspaces[0].folders[0]).toEqual({ id: 'f', name: 'F', sessions: [] });
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
