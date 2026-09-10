import { useEffect, useState } from 'react';
import type { SearchHit, SearchResponse, WorkspaceIndex } from '../../../shared/protocol.ts';
import { groupHits } from '../search-groups.ts';

type Props = {
  index: WorkspaceIndex | null;
  run: (q: string) => Promise<SearchResponse>;
  onOpen: (hit: SearchHit) => void;
};

export const Search = ({ index, run, onOpen }: Props) => {
  const [q, setQ] = useState('');
  const [state, setState] = useState<{ q: string; response: SearchResponse | null; error: string | null }>({ q: '', response: null, error: null });
  const trimmed = q.trim();
  // Busy is derived: the box holds a query the last answer does not cover yet.
  const busy = trimmed.length >= 2 && state.q !== trimmed;

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const timer = setTimeout(() => {
      run(query)
        .then((response) => setState({ q: query, response, error: null }))
        .catch((e: unknown) => setState({ q: query, response: null, error: String(e) }));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, run]);

  const groups = groupHits(index, state.response?.results ?? []);
  return (
    <div className="search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sessions" aria-label="search sessions" onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
      {busy && <div className="search-note">searching</div>}
      {state.error && !busy && <div className="search-note error">{state.error}</div>}
      {state.response && !busy && trimmed.length >= 2 && (
        <div className="search-results">
          {groups.length === 0 && <div className="search-note">no matches in {state.response.scanned} sessions</div>}
          {groups.map((g) => (
            <div key={g.name} className="search-group">
              <div className="search-group-name">{g.name}</div>
              {g.hits.map((hit) => (
                <button type="button" key={hit.sessionId} className="search-hit" onClick={() => onOpen(hit)} title={hit.sessionId}>
                  <span className="st">{hit.title}</span>
                  <span className="sm">turn {hit.turn}  {hit.snippet}</span>
                </button>
              ))}
            </div>
          ))}
          {state.response.truncated && <div className="search-note">more than {state.response.results.length} matches, narrow the search</div>}
        </div>
      )}
    </div>
  );
};
