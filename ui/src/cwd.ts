import type { IndexFolder, IndexWorkspace } from '../../shared/protocol.ts';

/** The directory a folder's sessions run in: the folder's own, or the workspace's. */
export const folderCwd = (ws: IndexWorkspace, folder: IndexFolder | null): string => folder?.cwd ?? ws.cwd;

/** Every directory whose CLI sessions belong under a workspace, without repeats. */
export const workspaceDirs = (ws: IndexWorkspace): string[] =>
  [...new Set([ws.cwd, ...ws.folders.map((f) => f.cwd).filter((d): d is string => Boolean(d))])];
