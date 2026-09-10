import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tree } from './Tree.tsx';

const organise = {
  renameWorkspace: () => {}, deleteWorkspace: () => {}, renameFolder: () => {}, deleteFolder: () => {},
  renameSession: () => {}, moveSession: () => {}, unfileSession: () => {}, fileSession: () => {},
};

const index = { version: 1 as const, workspaces: [{ id: 'w', name: 'Work', cwd: '/w', folders: [{ id: 'f', name: 'proj', sessions: [{ sessionId: 's1', cwd: '/w' }] }] }] };

describe('Tree', () => {
  it('renders the header with a hide button, the workspace, folder and session rows', () => {
    const html = renderToStaticMarkup(<Tree onCollapse={() => {}} organise={organise} search={null} index={index} unfiled={{}} sessions={{}} activeKey={null} onCreateWorkspace={() => {}} onCreateFolder={() => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    expect(html).toContain('class="rail-head"');
    expect(html).toContain('title="hide sidebar (Cmd+B)"');
    expect(html).toContain('Work');
    expect(html).toContain('proj');
    expect(html).toContain('title="s1"');
  });

  it('gives every row a menu, with move targets only for other folders', () => {
    const two = { ...index, workspaces: [{ ...index.workspaces[0], folders: [...index.workspaces[0].folders, { id: 'g', name: 'other', sessions: [] }] }] };
    const html = renderToStaticMarkup(<Tree onCollapse={() => {}} organise={organise} search={<div className="search-slot" />} index={two} unfiled={{}} sessions={{}} activeKey={null} onCreateWorkspace={() => {}} onCreateFolder={() => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    expect(html).toContain('aria-label="actions for Work"');
    expect(html).toContain('aria-label="actions for proj"');
    expect(html).toContain('aria-label="actions for s1"');
    expect(html).toContain('search-slot');
    expect(html.match(/aria-haspopup="menu"/g)?.length).toBe(4);
  });
});
