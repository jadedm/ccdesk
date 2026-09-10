// The library arrives on first use. If that import fails once, the failure must not be cached:
// `loading ??= import('mermaid')` would keep the rejected promise and every later diagram in the
// session would fail with the same stale error, with no way back short of a reload.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const realMermaid = { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg><text>ok</text></svg>' })) };

describe('loadMermaid', () => {
  beforeEach(() => {
    vi.resetModules();
    realMermaid.initialize.mockClear();
    realMermaid.render.mockClear();
  });

  afterEach(() => {
    vi.doUnmock('mermaid');
  });

  it('retries after a failed import instead of failing for the rest of the session', async () => {
    let attempt = 0;
    vi.doMock('mermaid', () => {
      attempt += 1;
      if (attempt === 1) throw new Error('chunk load failed');
      return { default: realMermaid };
    });

    const { renderDiagram } = await import('./mermaid.ts');

    // The import fails on the first attempt. What matters is that the failure is reported and
    // not remembered, so the exact wrapper message vitest produces is not asserted.
    const first = await renderDiagram('graph TD\n  A --> B', 'light');
    expect('error' in first).toBe(true);

    const second = await renderDiagram('graph TD\n  A --> B', 'light');
    expect('svg' in second && second.svg).toContain('ok');
    expect(attempt).toBe(2);
  });

  it('renders one diagram at a time, so two never share the library configuration', async () => {
    let inFlight = 0;
    let mostAtOnce = 0;
    const slowMermaid = {
      initialize: vi.fn(),
      render: vi.fn(async () => {
        inFlight += 1;
        mostAtOnce = Math.max(mostAtOnce, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { svg: '<svg><text>ok</text></svg>' };
      }),
    };
    vi.doMock('mermaid', () => ({ default: slowMermaid }));
    const { renderDiagram } = await import('./mermaid.ts');

    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => renderDiagram(`graph TD\n  A${n} --> B${n}`, 'light')));

    expect(mostAtOnce).toBe(1);
    expect(slowMermaid.render).toHaveBeenCalledTimes(5);
    // Queued, not dropped: every caller still gets its diagram.
    expect(results.every((r) => 'svg' in r)).toBe(true);
  });

  it('lets a failing diagram through without stalling the ones behind it', async () => {
    let attempt = 0;
    const flaky = {
      initialize: vi.fn(),
      render: vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('will not parse');
        return { svg: '<svg><text>ok</text></svg>' };
      }),
    };
    vi.doMock('mermaid', () => ({ default: flaky }));
    const { renderDiagram } = await import('./mermaid.ts');

    const results = await Promise.all([1, 2, 3].map((n) => renderDiagram(`graph TD\n  A${n} --> B${n}`, 'light')));

    expect('error' in results[0] && results[0].error).toContain('will not parse');
    expect(results.slice(1).every((r) => 'svg' in r)).toBe(true);
  });

  it('loads the library once when it works, and reconfigures it on a theme change', async () => {
    vi.doMock('mermaid', () => ({ default: realMermaid }));
    const { renderDiagram } = await import('./mermaid.ts');

    await renderDiagram('graph TD\n  A --> B', 'light');
    await renderDiagram('graph TD\n  A --> C', 'light');
    expect(realMermaid.initialize).toHaveBeenCalledTimes(1);

    // The diagram source is written by a model and the result is injected as markup. Loosening
    // this drops the sanitising pass and lets click directives bind callbacks, and every other
    // test in the suite would still pass.
    const config = realMermaid.initialize.mock.calls[0][0] as { securityLevel: string; startOnLoad: boolean };
    expect(config.securityLevel).toBe('strict');
    expect(config.startOnLoad).toBe(false);

    await renderDiagram('graph TD\n  A --> D', 'dark');
    expect(realMermaid.initialize).toHaveBeenCalledTimes(2);
    const dark = realMermaid.initialize.mock.calls[1][0] as { themeVariables: { background: string } };
    expect(dark.themeVariables.background).toBe('#15140f');
  });
});
