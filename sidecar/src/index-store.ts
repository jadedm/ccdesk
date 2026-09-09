import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { IndexFolder, IndexWorkspace, WorkspaceIndex } from '../../shared/protocol.ts';
import { badRequest, conflict, notFound } from './errors.ts';

const emptyIndex = (): WorkspaceIndex => ({ version: 1, workspaces: [] });

const cleanName = (name: unknown): string => {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed === '') throw badRequest('name_required');
  return trimmed;
};

const cleanPath = (value: unknown, code: string): string => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed.startsWith('/')) throw badRequest(code, 'absolute path required');
  return trimmed;
};

/** The workspace, folder and session index. Persisted as one JSON file, rewritten atomically. */
export class IndexStore {
  private index: WorkspaceIndex = emptyIndex();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    const raw = await readFile(this.path, 'utf8').catch(() => null);
    if (raw === null) return;
    const parsed = JSON.parse(raw) as WorkspaceIndex;
    if (parsed.version !== 1 || !Array.isArray(parsed.workspaces)) throw new Error(`unreadable index at ${this.path}`);
    this.index = parsed;
  }

  snapshot(): WorkspaceIndex {
    return structuredClone(this.index);
  }

  async createWorkspace(name: unknown, cwd: unknown): Promise<IndexWorkspace> {
    const workspace: IndexWorkspace = { id: randomUUID(), name: cleanName(name), cwd: cleanPath(cwd, 'cwd_required'), folders: [] };
    this.index.workspaces.push(workspace);
    await this.save();
    return structuredClone(workspace);
  }

  async createFolder(workspaceId: string, name: unknown): Promise<IndexFolder> {
    const workspace = this.workspace(workspaceId);
    const folder: IndexFolder = { id: randomUUID(), name: cleanName(name), sessions: [] };
    workspace.folders.push(folder);
    await this.save();
    return structuredClone(folder);
  }

  async fileSession(folderId: string, sessionId: unknown, cwd: unknown): Promise<IndexFolder> {
    const folder = this.folder(folderId);
    const id = typeof sessionId === 'string' && sessionId !== '' ? sessionId : null;
    if (id === null) throw badRequest('session_id_required');
    if (this.isFiled(id)) throw conflict('session_already_filed');
    folder.sessions.push({ sessionId: id, cwd: cleanPath(cwd, 'cwd_required') });
    await this.save();
    return structuredClone(folder);
  }

  private isFiled(sessionId: string): boolean {
    return this.index.workspaces.some((w) => w.folders.some((f) => f.sessions.some((s) => s.sessionId === sessionId)));
  }

  private workspace(id: string): IndexWorkspace {
    const found = this.index.workspaces.find((w) => w.id === id);
    if (!found) throw notFound('workspace_not_found');
    return found;
  }

  private folder(id: string): IndexFolder {
    const found = this.index.workspaces.flatMap((w) => w.folders).find((f) => f.id === id);
    if (!found) throw notFound('folder_not_found');
    return found;
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(this.index, null, 2) + '\n');
    await rename(tmp, this.path);
  }
}
