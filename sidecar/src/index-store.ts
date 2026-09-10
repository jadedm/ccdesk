import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { IndexFolder, IndexWorkspace, WorkspaceIndex } from '../../shared/protocol.ts';
import { badRequest, conflict, notFound } from './errors.ts';

const emptyIndex = (): WorkspaceIndex => ({ version: 1, workspaces: [] });

const parseIndex = (raw: string): WorkspaceIndex | null => {
  try {
    const parsed = JSON.parse(raw) as WorkspaceIndex;
    return parsed.version === 1 && Array.isArray(parsed.workspaces) ? parsed : null;
  } catch {
    return null;
  }
};

const cleanName = (name: unknown): string => {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed === '') throw badRequest('name_required');
  return trimmed;
};

/** Absolute, with trailing slashes dropped so `/w/b/` and `/w/b` are one directory. */
const cleanPath = (value: unknown, code: string): string => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed.startsWith('/')) throw badRequest(code, 'absolute path required');
  const stripped = trimmed.replace(/\/+$/, '');
  return stripped === '' ? '/' : stripped;
};

/** The workspace, folder and session index. Persisted as one JSON file, rewritten atomically. */
export class IndexStore {
  private index: WorkspaceIndex = emptyIndex();

  constructor(private readonly path: string) {}

  /** A corrupt or foreign index is moved aside and reported, never a reason to fail launch. */
  async load(): Promise<string | null> {
    const raw = await readFile(this.path, 'utf8').catch(() => null);
    if (raw === null) return null;
    const parsed = parseIndex(raw);
    if (parsed) {
      this.index = parsed;
      return null;
    }
    const aside = `${this.path}.unreadable-${Date.now()}`;
    await rename(this.path, aside);
    return `index at ${this.path} was unreadable and has been moved to ${aside}; starting empty`;
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

  /** A folder may carry its own directory; sessions started in it run there. */
  async createFolder(workspaceId: string, name: unknown, cwd?: unknown): Promise<IndexFolder> {
    const workspace = this.workspace(workspaceId);
    const folder: IndexFolder = { id: randomUUID(), name: cleanName(name), sessions: [] };
    if (cwd !== undefined && cwd !== null && cwd !== '') folder.cwd = cleanPath(cwd, 'bad_cwd');
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

  async renameWorkspace(workspaceId: string, name: unknown): Promise<IndexWorkspace> {
    const workspace = this.workspace(workspaceId);
    workspace.name = cleanName(name);
    await this.save();
    return structuredClone(workspace);
  }

  /** Removes the workspace and its folders from the index only; session files are never touched. */
  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.workspace(workspaceId);
    this.index.workspaces = this.index.workspaces.filter((w) => w.id !== workspaceId);
    await this.save();
  }

  async renameFolder(folderId: string, name: unknown): Promise<IndexFolder> {
    const folder = this.folder(folderId);
    folder.name = cleanName(name);
    await this.save();
    return structuredClone(folder);
  }

  /** Removes the folder; its sessions become unfiled again. */
  async deleteFolder(folderId: string): Promise<void> {
    const workspace = this.workspaceOfFolder(folderId);
    workspace.folders = workspace.folders.filter((f) => f.id !== folderId);
    await this.save();
  }

  /** Moves a filed session to another folder of the same workspace. */
  async moveSession(folderId: string, sessionId: string, targetFolderId: unknown): Promise<IndexFolder> {
    const from = this.folder(folderId);
    const target = typeof targetFolderId === 'string' ? this.folder(targetFolderId) : null;
    if (!target) throw badRequest('folder_id_required');
    const entry = from.sessions.find((s) => s.sessionId === sessionId);
    if (!entry) throw notFound('session_not_filed');
    if (this.workspaceOfFolder(folderId) !== this.workspaceOfFolder(target.id)) throw badRequest('cross_workspace', 'move within one workspace');
    from.sessions = from.sessions.filter((s) => s.sessionId !== sessionId);
    if (target !== from) target.sessions.push(entry);
    else from.sessions.push(entry);
    await this.save();
    return structuredClone(target);
  }

  async unfileSession(folderId: string, sessionId: string): Promise<void> {
    const folder = this.folder(folderId);
    if (!folder.sessions.some((s) => s.sessionId === sessionId)) throw notFound('session_not_filed');
    folder.sessions = folder.sessions.filter((s) => s.sessionId !== sessionId);
    await this.save();
  }

  private workspaceOfFolder(folderId: string): IndexWorkspace {
    const found = this.index.workspaces.find((w) => w.folders.some((f) => f.id === folderId));
    if (!found) throw notFound('folder_not_found');
    return found;
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
