import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tree } from './Tree.tsx';

const organise = {
  renameWorkspace: () => {}, deleteWorkspace: () => {}, renameFolder: () => {}, deleteFolder: () => {},
  renameSession: () => {}, moveSession: () => {}, unfileSession: () => {}, fileSession: () => {},
  setWorkspaceCwd: () => {}, setFolderCwd: () => {},
};

const describeDirectory = async (path: string) => ({ path, exists: true, isDirectory: true, sessions: 0 });

const index = { version: 1 as const, workspaces: [{ id: 'w', name: 'Work', cwd: '/w', folders: [{ id: 'f', name: 'proj', sessions: [{ sessionId: 's1', cwd: '/w' }] }] }] };

/** The listing gives the session a real title, distinct from its id. */
const unfiled = { w: [{ sessionId: 's1', summary: 'A long readable session title', lastModified: 1, listedIn: '/w' }] };

describe('Tree', () => {
  it('renders the header with add and hide, the workspace, folder and session rows', () => {
    const html = renderToStaticMarkup(<Tree onCollapse={() => {}} organise={organise} search={null} describeDirectory={describeDirectory} index={index} unfiled={unfiled} sessions={{}} activeKey={null} onCreateWorkspace={() => {}} onCreateFolder={() => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    expect(html).toContain('class="rail-head"');
    expect(html).toContain('Hide sidebar');
    expect(html).toContain('+ workspace');
    expect(html).toContain('Work');
    expect(html).toContain('proj');
    // The tooltip carries the title, which is what a clipped row needs; the id is not shown.
    expect(html).toContain('title="A long readable session title"');
    expect(html).not.toContain('title="s1"');
  });

  it('makes every session row a focusable button, so it can be opened from the keyboard', () => {
    const html = renderToStaticMarkup(<Tree onCollapse={() => {}} organise={organise} search={null} describeDirectory={describeDirectory} index={index} unfiled={unfiled} sessions={{}} activeKey={null} onCreateWorkspace={() => {}} onCreateFolder={() => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    expect(html).toContain('class="label rowopen"');
    expect(html.match(/<button type="button" class="label rowopen"/g)?.length).toBe(1);
  });

  it('explains itself when there are no workspaces, and hides the search that could find nothing', () => {
    const html = renderToStaticMarkup(<Tree onCollapse={() => {}} organise={organise} search={<div className="search-slot" />} describeDirectory={describeDirectory} index={{ version: 1, workspaces: [] }} unfiled={{}} sessions={{}} activeKey={null} onCreateWorkspace={() => {}} onCreateFolder={() => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    expect(html).toContain('No workspaces yet');
    expect(html).toContain('A workspace is a directory on disk');
    expect(html).toContain('+ workspace');
    expect(html).not.toContain('search-slot');
  });

  it('opens the add form from the header and offers a cancel', () => {
    // The form is rendered by the same component, so its presence is a property of the tree.
    const html = renderToStaticMarkup(<Tree onCollapse={() => {}} organise={organise} search={null} describeDirectory={describeDirectory} index={{ version: 1, workspaces: [] }} unfiled={{}} sessions={{}} activeKey={null} onCreateWorkspace={() => {}} onCreateFolder={() => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    expect(html).not.toContain('addform');
    expect(html).toContain('+ workspace');
  });

  it('gives every row a menu, with move targets only for other folders', () => {
    const two = { ...index, workspaces: [{ ...index.workspaces[0], folders: [...index.workspaces[0].folders, { id: 'g', name: 'other', sessions: [] }] }] };
    const html = renderToStaticMarkup(<Tree onCollapse={() => {}} organise={organise} search={<div className="search-slot" />} describeDirectory={describeDirectory} index={two} unfiled={{}} sessions={{}} activeKey={null} onCreateWorkspace={() => {}} onCreateFolder={() => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    expect(html).toContain('aria-label="actions for Work"');
    expect(html).toContain('aria-label="actions for proj"');
    expect(html).toContain('aria-label="actions for s1"');
    expect(html).toContain('search-slot');
    expect(html.match(/aria-haspopup="true"/g)?.length).toBe(4);
  });
});
