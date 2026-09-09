import { describe, expect, it } from 'vitest';
import { metaLine } from './meta.ts';

describe('session metadata line', () => {
  it('shows date, count and short model, and skips what is missing', () => {
    const line = metaLine({ lastModified: Date.UTC(2026, 8, 9, 10, 5), messages: 104, model: 'claude-fable-5-1' });
    // Date formatting follows the runner's locale; assert the three parts and that the date has digits.
    const parts = line.split('  ');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/\d/);
    expect(line).toContain('104 msgs');
    expect(line).toContain('fable-5-1');
    expect(line).not.toContain('claude-');
    expect(metaLine({ messages: 0 })).toBe('0 msgs');
    expect(metaLine({})).toBe('');
  });
});
