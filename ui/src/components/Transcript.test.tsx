import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlockView } from './Transcript.tsx';

const block = { kind: 'text' as const, id: 't1', text: 'Reading **words** with `code` and a [link](https://x.y) here.', streaming: false };

describe('BlockView', () => {
  it('bolds word prefixes in prose only when bionic is on, leaving code and links alone', () => {
    const off = renderToStaticMarkup(<BlockView block={block} bionic={false} />);
    const on = renderToStaticMarkup(<BlockView block={block} bionic={true} />);
    expect(off).not.toContain('class="bio"');
    expect(on).toContain('<b class="bio">Rea</b>ding');
    expect(on).toContain('<code>code</code>');
    expect(on).toContain('<a href="https://x.y">');
    expect(on.match(/<b class="bio">/g)?.length).toBeGreaterThan(3);
  });
});
