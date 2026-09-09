import { describe, expect, it } from 'vitest';
import { folderCwd, mergeListings, workspaceDirs } from './cwd.ts';

const ws = { id: 'w', name: 'W', cwd: '/w', folders: [
  { id: 'a', name: 'a', sessions: [] },
  { id: 'b', name: 'b', cwd: '/w/b', sessions: [] },
  { id: 'c', name: 'c', cwd: '/w', sessions: [] },
] };

describe('folder directories', () => {
  it('runs sessions in the folder directory when set, else the workspace directory', () => {
    expect(folderCwd(ws, ws.folders[0])).toBe('/w');
    expect(folderCwd(ws, ws.folders[1])).toBe('/w/b');
    expect(folderCwd(ws, null)).toBe('/w');
  });

  it('tags each listed session with the directory it came from and drops repeats', () => {
    const a = { sessionId: 's1', summary: 'one', lastModified: 1 };
    const b = { sessionId: 's2', summary: 'two', lastModified: 2 };
    const merged = mergeListings(['/w', '/w/b'], [[a], [b, a]]);
    expect(merged.map((s) => [s.sessionId, s.listedIn])).toEqual([['s1', '/w'], ['s2', '/w/b']]);
  });

  it('lists the workspace and folder directories once each for the unfiled scan', () => {
    expect(workspaceDirs(ws)).toEqual(['/w', '/w/b']);
  });
});
