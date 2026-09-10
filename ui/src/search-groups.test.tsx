import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Search } from './components/Search.tsx';
import { groupHits } from './search-groups.ts';
import type { SearchHit, WorkspaceIndex } from '../../shared/protocol.ts';

const index: WorkspaceIndex = { version: 1, workspaces: [
  { id: 'w1', name: 'Work', cwd: '/w1', folders: [] },
  { id: 'w2', name: 'Home', cwd: '/w2', folders: [] },
] };

const hit = (id: string, workspaceId: string, lastModified: number): SearchHit => ({ sessionId: id, cwd: '/w', workspaceId, title: `T-${id}`, turn: 2, snippet: 'about pears', lastModified });

describe('search results', () => {
  it('groups hits by workspace in index order and drops empty groups', () => {
    const groups = groupHits(index, [hit('a', 'w2', 3), hit('b', 'w1', 2), hit('c', 'w2', 1)]);
    expect(groups.map((g) => [g.name, g.hits.length])).toEqual([['Work', 1], ['Home', 2]]);
    expect(groupHits(index, [])).toEqual([]);
    expect(groupHits(index, [hit('d', 'gone', 1)]).map((g) => g.name)).toEqual(['elsewhere']);
    expect(groupHits(null, [hit('e', 'w1', 1)]).map((g) => g.name)).toEqual(['elsewhere']);
  });

  it('renders the box empty until a query is typed', () => {
    const html = renderToStaticMarkup(<Search index={index} run={async () => ({ results: [], scanned: 0, skipped: 0, truncated: false })} onOpen={() => {}} />);
    expect(html).toContain('aria-label="search sessions"');
    expect(html).not.toContain('search-results');
  });
});
