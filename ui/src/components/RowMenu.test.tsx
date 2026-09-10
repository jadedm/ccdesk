import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RowMenu } from './RowMenu.tsx';

describe('RowMenu', () => {
  it('renders a labelled trigger, closed, and nothing at all with no actions', () => {
    const html = renderToStaticMarkup(<RowMenu label="session actions" actions={[{ label: 'Rename', onPick: () => {} }, { label: 'Delete', onPick: () => {}, danger: true }]} />);
    expect(html).toContain('aria-label="session actions"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="menu"');
    expect(renderToStaticMarkup(<RowMenu label="x" actions={[]} />)).toBe('');
  });
});
