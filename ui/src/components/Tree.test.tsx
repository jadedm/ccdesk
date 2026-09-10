import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tree } from './Tree.tsx';

const organise = {
  renameWorkspace: () => {}, deleteWorkspace: () => {}, renameFolder: () => {}, deleteFolder: () => {},
  renameSession: () => {}, moveSession: () => {}, unfileSession: () => {}, fileSession: () => {},
  setWorkspaceCwd: () => {}, setFolderCwd: () => {},
};

const describeDirectory = async (path: string) => ({ path, exists: true, isDirectory: true, readable: true, sessions: 0, problem: null });

const index = { version: 1 as const, workspaces: [{ id: 'w', name: 'Work', cwd: '/w', folders: [{ id: 'f', name: 'proj', sessions: [{ sessionId: 's1', cwd: '/w' }] }] }] };

/** The listing gives the session a real title, distinct from its id. */
const unfiled = { w: [{ sessionId: 's1', summary: 'A long readable session title', lastModified: 1, listedIn: '/w' }] };

afterEach(cleanup);

describe('Tree', () => {
  it('renders the header with add and hide, the workspace, folder and session rows', () => {
    const html = renderToStaticMarkup(<Tree onCollapse={() => {}} organise={organise} search={null} describeDirectory={describeDirectory} index={index} unfiled={unfiled} sessions={{}} activeKey={null} onCreateWorkspace={async () => {}} onCreateFolder={async () => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
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
    const html = renderToStaticMarkup(<Tree onCollapse={() => {}} organise={organise} search={null} describeDirectory={describeDirectory} index={index} unfiled={unfiled} sessions={{}} activeKey={null} onCreateWorkspace={async () => {}} onCreateFolder={async () => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    expect(html).toContain('class="label rowopen"');
    expect(html.match(/<button type="button" class="label rowopen"/g)?.length).toBe(1);
  });

  it('explains itself when there are no workspaces, and hides the search that could find nothing', () => {
    const html = renderToStaticMarkup(<Tree onCollapse={() => {}} organise={organise} search={<div className="search-slot" />} describeDirectory={describeDirectory} index={{ version: 1, workspaces: [] }} unfiled={{}} sessions={{}} activeKey={null} onCreateWorkspace={async () => {}} onCreateFolder={async () => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    expect(html).toContain('No workspaces yet');
    expect(html).toContain('A workspace is a directory on disk');
    expect(html).toContain('+ workspace');
    expect(html).not.toContain('search-slot');
  });

  it('opens the add form from the header, and the same trigger closes it again', async () => {
    const user = userEvent.setup();
    render(<Tree onCollapse={() => {}} organise={organise} search={null} describeDirectory={describeDirectory} index={{ version: 1, workspaces: [] }} unfiled={{}} sessions={{}} activeKey={null} onCreateWorkspace={async () => {}} onCreateFolder={async () => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    expect(screen.queryByRole('form', { name: 'New workspace' })).toBeNull();
    const trigger = screen.getByRole('button', { name: '+ workspace' });
    await user.click(trigger);
    expect(screen.getByRole('form', { name: 'New workspace' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '+ workspace' }));
    expect(screen.queryByRole('form', { name: 'New workspace' })).toBeNull();
  });

  it('asks before discarding typing, whichever way the form is left', async () => {
    const user = userEvent.setup();
    const onCollapse = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Tree onCollapse={onCollapse} organise={organise} search={null} describeDirectory={describeDirectory} index={{ version: 1, workspaces: [] }} unfiled={{}} sessions={{}} activeKey={null} onCreateWorkspace={async () => {}} onCreateFolder={async () => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    await user.click(screen.getByRole('button', { name: '+ workspace' }));
    await user.type(screen.getByLabelText(/^name/i), 'half typed');

    // Closing by the same trigger asks, and declining keeps the form and its text.
    await user.click(screen.getByRole('button', { name: '+ workspace' }));
    expect(confirm).toHaveBeenCalled();
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe('half typed');

    // Hiding the rail asks too, and declining does not hide it.
    await user.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    expect(onCollapse).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it('returns focus to the trigger when the form is cancelled', async () => {
    const user = userEvent.setup();
    render(<Tree onCollapse={() => {}} organise={organise} search={null} describeDirectory={describeDirectory} index={{ version: 1, workspaces: [] }} unfiled={{}} sessions={{}} activeKey={null} onCreateWorkspace={async () => {}} onCreateFolder={async () => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    await user.click(screen.getByRole('button', { name: '+ workspace' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ workspace' })));
  });

  it('gives every row a menu, with move targets only for other folders', () => {
    const two = { ...index, workspaces: [{ ...index.workspaces[0], folders: [...index.workspaces[0].folders, { id: 'g', name: 'other', sessions: [] }] }] };
    const html = renderToStaticMarkup(<Tree onCollapse={() => {}} organise={organise} search={<div className="search-slot" />} describeDirectory={describeDirectory} index={two} unfiled={{}} sessions={{}} activeKey={null} onCreateWorkspace={async () => {}} onCreateFolder={async () => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    expect(html).toContain('aria-label="actions for Work"');
    expect(html).toContain('aria-label="actions for proj"');
    expect(html).toContain('aria-label="actions for s1"');
    expect(html).toContain('search-slot');
    expect(html.match(/aria-haspopup="true"/g)?.length).toBe(4);
  });
});
