import { describe, expect, it } from 'vitest';
import { cycle, withClosed, withOpened } from './tabs.ts';

describe('tabs', () => {
  it('keeps open order and never duplicates', () => {
    let open: string[] = [];
    for (const k of ['A', 'B', 'C', 'A']) open = withOpened(open, k);
    expect(open).toEqual(['A', 'B', 'C']);
  });

  it('closing the active tab focuses the left neighbour, then the right, then nothing', () => {
    let s = withClosed(['A', 'B', 'C'], 'B', 'B');
    expect(s).toEqual({ open: ['A', 'C'], active: 'A' });
    s = withClosed(s.open, s.active, 'A');
    expect(s).toEqual({ open: ['C'], active: 'C' });
    s = withClosed(s.open, s.active, 'C');
    expect(s).toEqual({ open: [], active: null });
  });

  it('closing an inactive tab leaves the active one alone, and unknown keys are ignored', () => {
    expect(withClosed(['A', 'B', 'C'], 'C', 'A')).toEqual({ open: ['B', 'C'], active: 'C' });
    expect(withClosed(['A'], 'A', 'Z')).toEqual({ open: ['A'], active: 'A' });
  });

  it('cycles with wrap-around and stays put on a single tab', () => {
    expect(cycle(['A', 'B', 'C'], 'B', 1)).toBe('C');
    expect(cycle(['A', 'B', 'C'], 'C', 1)).toBe('A');
    expect(cycle(['A', 'B', 'C'], 'A', -1)).toBe('C');
    expect(cycle(['A'], 'A', 1)).toBe('A');
    expect(cycle([], null, 1)).toBeNull();
    expect(cycle(['A', 'B'], null, 1)).toBe('A');
  });
});
