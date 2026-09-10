// No test in this project loads index.css: it is imported from main.tsx only. So the whole
// stylesheet half of the composer fix could be reverted and every render test would stay green,
// which is how the button came to be 30px against a 45px field in the first place.
//
// These cases read the stylesheet as text and pin the two things a revert would break: the field
// and its button take their height from one property, and the composer override sits after the
// rules it has to beat on source order. Pixel behaviour is measured in a browser, on #24; jsdom
// has no layout engine and reports every height as zero.
/// <reference types="node" />
// Read as a file, not as an import: vitest stubs css imports, so `../index.css?raw` arrives here
// as an empty string and every assertion below would pass against nothing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest runs with the ui package as its root.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

const declaration = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return css.slice(at + 1, css.indexOf('}', at) + 1);
};

describe('composer stylesheet contract', () => {
  it('is reading a real stylesheet, not an empty stub', () => {
    expect(css.length).toBeGreaterThan(1000);
    expect(css).toContain('.composer {');
  });

  it('gives the field and its button one shared resting height', () => {
    expect(css).toMatch(/--composer-control-h:\s*\d+px/);
    expect(declaration('.composer textarea')).toContain('min-height: var(--composer-control-h)');
    expect(declaration('.composer .btn')).toContain('min-height: var(--composer-control-h)');
  });

  it('matches the button to the field rather than to the other buttons', () => {
    const btn = declaration('.composer .btn');
    const field = declaration('.composer textarea');
    const radius = (rule: string) => /border-radius:\s*([^;]+);/.exec(rule)?.[1];
    expect(radius(btn)).toBe(radius(field));
    expect(btn).toContain('flex: none');
  });

  it('puts the composer override after the .btn rules it shares specificity with', () => {
    const override = css.indexOf('\n.composer .btn {');
    for (const rule of ['\n.btn {', '\n.btn.primary {', '\n.btn.danger {', '\n.btn:disabled {']) {
      expect(css.indexOf(rule)).toBeLessThan(override);
    }
  });

  it('keeps the composer row bottom-aligned, so the button holds the edge as the field grows', () => {
    expect(declaration('.composer')).toContain('align-items: flex-end');
  });

  it('reads the hint in a colour that clears 4.5:1 on both themes', () => {
    // 10.5px hint text. --faint is 2.33:1 on light and --muted is 3.37:1, both below AA.
    expect(declaration('.composer-hint')).toContain('color: var(--ink2)');
  });
});
