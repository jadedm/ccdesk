import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tree } from './Tree.tsx';

const index = { version: 1 as const, workspaces: [{ id: 'w', name: 'Work', cwd: '/w', folders: [{ id: 'f', name: 'proj', sessions: [{ sessionId: 's1', cwd: '/w' }] }] }] };

describe('Tree', () => {
  it('renders the header with a hide button, the workspace, folder and session rows', () => {
    const html = renderToStaticMarkup(<Tree onCollapse={() => {}} index={index} unfiled={{}} sessions={{}} activeKey={null} onCreateWorkspace={() => {}} onCreateFolder={() => {}} onNewSession={() => {}} onOpenSession={() => {}} />);
    expect(html).toContain('class="rail-head"');
    expect(html).toContain('title="hide sidebar (Cmd+B)"');
    expect(html).toContain('Work');
    expect(html).toContain('proj');
    expect(html).toContain('title="s1"');
  });
});
