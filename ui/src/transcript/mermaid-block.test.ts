import { describe, expect, it } from 'vitest';
import { fenceText, isMermaid } from './mermaid-block.ts';

describe('which blocks are diagrams', () => {
  it('takes only an explicit mermaid fence', () => {
    expect(isMermaid('language-mermaid')).toBe(true);
    expect(isMermaid('lang math language-mermaid')).toBe(true);
    expect(isMermaid('language-ts')).toBe(false);
    expect(isMermaid('language-bash')).toBe(false);
    // Prose about mermaid, or a fence that merely mentions it, is not a diagram.
    expect(isMermaid('language-mermaidish')).toBe(false);
    expect(isMermaid(undefined)).toBe(false);
    expect(isMermaid('')).toBe(false);
  });

  it('reads the fence body as written, minus the newline markdown appends', () => {
    expect(fenceText('graph TD\n  A --> B\n')).toBe('graph TD\n  A --> B');
    expect(fenceText(['graph TD\n', '  A --> B\n'])).toBe('graph TD\n  A --> B');
    expect(fenceText([{ type: 'element' }, 'text'])).toBe('text');
    expect(fenceText(undefined)).toBe('');
  });
});
