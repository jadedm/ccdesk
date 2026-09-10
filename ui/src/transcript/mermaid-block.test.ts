import { describe, expect, it } from 'vitest';
import { fenceText, isMermaid, isMermaidFence } from './mermaid-block.ts';

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

describe('isMermaidFence', () => {
  const fence = (className: string | undefined) => ({ props: { className } });

  it('recognises the mermaid fence markdown wraps in a pre', () => {
    expect(isMermaidFence(fence('language-mermaid'))).toBe(true);
    expect(isMermaidFence([fence('language-mermaid')])).toBe(true);
    expect(isMermaidFence(['\n', fence('language-mermaid')])).toBe(true);
  });

  it('leaves every other fence in its pre', () => {
    expect(isMermaidFence(fence('language-ts'))).toBe(false);
    expect(isMermaidFence(fence(undefined))).toBe(false);
    expect(isMermaidFence(fence('language-mermaidish'))).toBe(false);
    expect(isMermaidFence('just text')).toBe(false);
    expect(isMermaidFence(null)).toBe(false);
    expect(isMermaidFence(undefined)).toBe(false);
    expect(isMermaidFence([])).toBe(false);
    expect(isMermaidFence({ props: null })).toBe(false);
    expect(isMermaidFence({})).toBe(false);
  });
});
