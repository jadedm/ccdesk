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

  it('loads the library once when it works, and reconfigures it on a theme change', async () => {
    vi.doMock('mermaid', () => ({ default: realMermaid }));
    const { renderDiagram } = await import('./mermaid.ts');

    await renderDiagram('graph TD\n  A --> B', 'light');
    await renderDiagram('graph TD\n  A --> C', 'light');
    expect(realMermaid.initialize).toHaveBeenCalledTimes(1);

    await renderDiagram('graph TD\n  A --> D', 'dark');
    expect(realMermaid.initialize).toHaveBeenCalledTimes(2);
    const dark = realMermaid.initialize.mock.calls[1][0] as { themeVariables: { background: string } };
    expect(dark.themeVariables.background).toBe('#15140f');
  });
});
