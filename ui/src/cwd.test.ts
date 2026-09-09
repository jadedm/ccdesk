import { describe, expect, it } from 'vitest';
import { folderCwd, workspaceDirs } from './cwd.ts';

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

  it('lists the workspace and folder directories once each for the unfiled scan', () => {
    expect(workspaceDirs(ws)).toEqual(['/w', '/w/b']);
  });
});
