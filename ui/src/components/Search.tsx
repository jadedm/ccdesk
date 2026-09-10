import { useEffect, useRef, useState } from 'react';
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
  // Busy is derived: the box holds a query the last answer does not cover yet. An error
  // belongs to the query that produced it, so a shorter box hides it without a state write.
  const busy = trimmed.length >= 2 && state.q !== trimmed;
  const error = trimmed.length >= 2 && !busy ? state.error : null;

  const latest = useRef('');
  useEffect(() => {
    const query = q.trim();
    latest.current = query;
    if (query.length < 2) return;
    const timer = setTimeout(() => {
      // A slower earlier query must not overwrite a newer answer.
      const keep = (write: () => void) => latest.current === query && write();
      run(query)
        .then((response) => keep(() => setState({ q: query, response, error: null })))
        .catch((e: unknown) => keep(() => setState({ q: query, response: null, error: String(e) })));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, run]);

  const groups = groupHits(index, state.response?.results ?? []);
  return (
    <div className="search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sessions" aria-label="search sessions" onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
      {busy && <div className="search-note">searching</div>}
      {error && <div className="search-note error">{error}</div>}
      {state.response && !busy && trimmed.length >= 2 && (
        <div className="search-results">
          {groups.length === 0 && <div className="search-note">no matches in {state.response.scanned} sessions{state.response.skipped > 0 ? `, ${state.response.skipped} unreadable` : ''}</div>}
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
