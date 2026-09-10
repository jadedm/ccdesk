import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlockView, Transcript } from './Transcript.tsx';
import { keepAtBottom, visible, type View } from '../transcript/view.ts';
import type { Block } from '../transcript/blocks.ts';

const block = { kind: 'text' as const, id: 't1', text: 'Reading **words** with `code` and a [link](https://x.y) here.', streaming: false };

const all: View = { hideThinking: false, showTools: true, showSystem: true, bionic: false, theme: 'light' };

describe('BlockView', () => {
  it('bolds word prefixes in prose only when bionic is on, leaving code and links alone', () => {
    const off = renderToStaticMarkup(<BlockView block={block} bionic={false} theme="light" />);
    const on = renderToStaticMarkup(<BlockView block={block} bionic={true} theme="light" />);
    expect(off).not.toContain('class="bio"');
    expect(on).toContain('<b class="bio">Rea</b>ding');
    expect(on).toContain('<code>code</code>');
    expect(on).toContain('<a href="https://x.y">');
    expect(on.match(/<b class="bio">/g)?.length).toBeGreaterThan(3);
  });

  it('labels a user turn with who and when', () => {
    const user = renderToStaticMarkup(<BlockView block={{ kind: 'user', id: 'u', text: 'hi', at: '2026-09-09T10:05:00Z' }} bionic={false} theme="light" />);
    expect(user).toContain('class="who">you<');
    expect(user).toMatch(/class="time">\d{1,2}:\d{2}/);
    const unstamped = renderToStaticMarkup(<BlockView block={{ kind: 'user', id: 'u', text: 'hi' }} bionic={false} theme="light" />);
    expect(unstamped).not.toContain('class="time"');
  });

  it('puts the claude label before the first visible reply block, even when thinking is hidden', () => {
    const turn = { id: 'turn-1', replyAt: '2026-09-09T10:05:30Z', blocks: [
      { kind: 'user' as const, id: 'u', text: 'hi' },
      { kind: 'thinking' as const, id: 'th', text: 'hm', streaming: false },
      { ...block },
    ] };
    const html = renderToStaticMarkup(<Transcript transcript={{ turns: [turn] }} view={{ hideThinking: true, showTools: true, showSystem: false, bionic: false, theme: 'light' }} sessionKey="k" following={false} />);
    const label = html.indexOf('class="who">claude<');
    expect(label).toBeGreaterThan(-1);
    expect(html.indexOf('class="prose"')).toBeGreaterThan(label);
    expect(html).not.toContain('class="thinking"');
    const none = renderToStaticMarkup(<Transcript transcript={{ turns: [{ ...turn, replyAt: undefined }] }} view={all} sessionKey="k" following={false} />);
    expect(none).not.toContain('class="who">claude<');
  });
});

describe('follow rule', () => {
  it('follows the end only while running and already near the bottom', () => {
    expect(keepAtBottom(true, 0)).toBe(true);
    expect(keepAtBottom(true, 100)).toBe(true);
    expect(keepAtBottom(true, 800)).toBe(false);
    expect(keepAtBottom(false, 0)).toBe(false);
  });
});

describe('turn chrome', () => {
  it('renders turns without a number, the role label marks the start', () => {
    const t = { turns: [{ id: 'a', blocks: [{ kind: 'user' as const, id: 'u1', text: 'one', at: '2026-09-09T10:00:00Z' }] }, { id: 'b', blocks: [{ kind: 'user' as const, id: 'u2', text: 'two' }] }] };
    const html = renderToStaticMarkup(<Transcript transcript={t} view={all} sessionKey="k" following={false} />);
    expect(html).not.toContain('turn-index');
    expect(html.match(/class="who">you</g)?.length).toBe(2);
  });
});

describe('view toggles', () => {
  const blocks: Block[] = [
    { kind: 'user', id: 'u', text: 'go' },
    { kind: 'system', id: 's', tag: 'system-reminder', text: 'rules' },
    { kind: 'tool', id: 'tool_1', name: 'Bash', input: { command: 'ls' }, summary: 'ls', streaming: false },
    { kind: 'thinking', id: 'th', text: 'hm', streaming: false },
    { kind: 'text', id: 't', text: 'done', streaming: false },
  ];
  const transcript = { turns: [{ id: 'turn-1', blocks }] };

  it('hides tool lines, system blocks and thinking according to the view', () => {
    const shown = renderToStaticMarkup(<Transcript transcript={transcript} view={all} sessionKey="k" following={false} />);
    expect(shown).toContain('class="tool"');
    expect(shown).toContain('class="system"');
    expect(shown).toContain('class="thinking"');
    const hidden = renderToStaticMarkup(<Transcript transcript={transcript} view={{ hideThinking: true, showTools: false, showSystem: false, bionic: false, theme: 'light' }} sessionKey="k" following={false} />);
    expect(hidden).not.toContain('class="tool"');
    expect(hidden).not.toContain('class="system"');
    expect(hidden).not.toContain('class="thinking"');
    expect(hidden).toContain('done');
    expect(blocks.filter((b) => visible(b, all))).toHaveLength(5);
  });
});

// A diagram is not code. Markdown wraps every fence in a pre, and a diagram left inside that
// wrapper is drawn in the code-block box, with a div inside a pre and the source pre nested inside
// that. Measured in the app before the fix: the diagram's parent was a pre with the code-block
// padding, border and background, and one pre sat inside another.
describe('a mermaid fence leaves its pre behind', () => {
  const withFence = (lang: string) => ({
    kind: 'text' as const,
    id: 'd1',
    text: `Before\n\n\`\`\`${lang}\ngraph TD\n  A[One] --> B[Two]\n\`\`\`\n\nAfter`,
    streaming: false,
  });

  it('renders the diagram outside any pre', () => {
    const html = renderToStaticMarkup(<BlockView block={withFence('mermaid')} bionic={false} theme="light" />);
    expect(html).toContain('class="diagram"');
    expect(html).not.toMatch(/<pre[^>]*>\s*<div class="diagram"/);
    expect(html).not.toContain('<pre><pre');
  });

  it('keeps every other fence in its pre', () => {
    const html = renderToStaticMarkup(<BlockView block={withFence('ts')} bionic={false} theme="light" />);
    expect(html).not.toContain('class="diagram"');
    expect(html).toMatch(/<pre[^>]*>\s*<code class="language-ts"/);
  });
});
