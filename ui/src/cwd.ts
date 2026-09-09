import type { IndexFolder, IndexWorkspace, SessionSummary } from '../../shared/protocol.ts';

/** A CLI session as listed for a workspace, tagged with the directory it was listed from. */
export type ListedSession = SessionSummary & { listedIn: string };

/** The directory a folder's sessions run in: the folder's own, or the workspace's. */
export const folderCwd = (ws: IndexWorkspace, folder: IndexFolder | null): string => folder?.cwd ?? ws.cwd;

/** Merge per-directory listings into one, first directory wins on a repeated id, and keep
 * the source directory on each entry: opening or resuming the session needs that store. */
export const mergeListings = (dirs: string[], lists: SessionSummary[][]): ListedSession[] => {
  const seen = new Set<string>();
  const out: ListedSession[] = [];
  dirs.forEach((dir, i) => {
    for (const s of lists[i] ?? []) {
      if (seen.has(s.sessionId)) continue;
      seen.add(s.sessionId);
      out.push({ ...s, listedIn: dir });
    }
  });
  return out;
};

/** Every directory whose CLI sessions belong under a workspace, without repeats. */
export const workspaceDirs = (ws: IndexWorkspace): string[] =>
  [...new Set([ws.cwd, ...ws.folders.map((f) => f.cwd).filter((d): d is string => Boolean(d))])];
