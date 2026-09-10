import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tabs } from './Tabs.tsx';
import type { SessionView } from '../state.ts';

const view = (key: string, title: string, status: SessionView['status']): SessionView => ({
  key, sessionId: null, cwd: '/w', folderId: null, title, status, transcript: { turns: [] }, permission: null, error: null,
});

describe('Tabs', () => {
  it('renders one tab per open key with its title, the active mark and a close button', () => {
    const sessions = { a: view('a', 'Alpha', 'history'), b: view('b', 'Beta', 'running') };
    const html = renderToStaticMarkup(<Tabs open={['a', 'b']} sessions={sessions} activeKey="b" onActivate={() => {}} onClose={() => {}} />);
    expect(html.match(/role="tab"/g)?.length).toBe(2);
    expect(html).toContain('Alpha');
    expect(html).toContain('class="tab active"');
    expect(html.match(/class="tab-close"/g)?.length).toBe(2);
    expect(html).toContain('class="dot running"');
    expect(renderToStaticMarkup(<Tabs open={[]} sessions={{}} activeKey={null} onActivate={() => {}} onClose={() => {}} />)).toBe('');
  });
});
