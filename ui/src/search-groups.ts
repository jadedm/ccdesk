import type { SearchHit, WorkspaceIndex } from '../../shared/protocol.ts';

/** Groups hits by workspace in the index's order; hits from unknown workspaces go last. */
export const groupHits = (index: WorkspaceIndex | null, hits: SearchHit[]): Array<{ name: string; hits: SearchHit[] }> => {
  const names = new Map((index?.workspaces ?? []).map((w) => [w.id, w.name] as const));
  const groups = new Map<string, SearchHit[]>();
  for (const w of index?.workspaces ?? []) groups.set(w.id, []);
  for (const hit of hits) {
    if (!groups.has(hit.workspaceId)) groups.set(hit.workspaceId, []);
    groups.get(hit.workspaceId)!.push(hit);
  }
  return [...groups.entries()].filter(([, h]) => h.length > 0).map(([id, h]) => ({ name: names.get(id) ?? 'elsewhere', hits: h }));
};
