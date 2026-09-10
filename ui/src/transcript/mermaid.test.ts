// One reply can hold several diagrams, and they render at the same time. Mermaid measures each
// one inside a temporary node it puts in the document, so anything that cleans up by matching a
// shared id prefix destroys a node another render is still using. Measured in a browser before
// the fix: eight concurrent diagrams, seven failed with "Cannot read properties of null".
import { afterEach, describe, expect, it } from 'vitest';
import { renderDiagram, resetMermaid } from './mermaid.ts';

afterEach(resetMermaid);

const flow = (n: number) => `graph TD\n  A${n}[Node ${n}] --> B${n}[End ${n}]`;

describe('renderDiagram', () => {
  it('renders several diagrams at once without one destroying another', async () => {
    const results = await Promise.all([0, 1, 2, 3].map((n) => renderDiagram(flow(n), 'light')));
    const failures = results.map((r, i) => ('error' in r ? `${i}: ${r.error}` : null)).filter(Boolean);
    expect(failures).toEqual([]);
    // Each diagram must carry its own content, not a neighbour's.
    results.forEach((result, n) => {
      expect('svg' in result && result.svg).toContain(`Node ${n}`);
    });
  }, 60000);

  it('leaves no measuring nodes behind, on success or on failure', async () => {
    await Promise.all([renderDiagram(flow(9), 'light'), renderDiagram('graph TD\n  A --> [', 'light')]);
    expect(document.querySelectorAll('[id^="dccdesk-diagram-"]').length).toBe(0);
  }, 60000);

  it('treats an empty diagram as a failure rather than rendering nothing', async () => {
    const result = await renderDiagram('   \n  ', 'light');
    expect('error' in result && result.error).toBe('Empty diagram.');
  });
});
