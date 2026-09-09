import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlockView, Transcript } from './Transcript.tsx';
import { visible, type View } from '../transcript/view.ts';
import type { Block } from '../transcript/blocks.ts';

const block = { kind: 'text' as const, id: 't1', text: 'Reading **words** with `code` and a [link](https://x.y) here.', streaming: false };

const all: View = { hideThinking: false, showTools: true, showSystem: true, bionic: false };

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

  it('labels a user turn and a timestamped reply with who and when', () => {
    const user = renderToStaticMarkup(<BlockView block={{ kind: 'user', id: 'u', text: 'hi', at: '2026-09-09T10:05:00Z' }} bionic={false} />);
    expect(user).toContain('class="who">you<');
    expect(user).toMatch(/class="time">\d{1,2}:\d{2}/);
    const reply = renderToStaticMarkup(<BlockView block={{ ...block, at: '2026-09-09T10:05:30Z' }} bionic={false} />);
    expect(reply).toContain('class="who">claude<');
    const unstamped = renderToStaticMarkup(<BlockView block={block} bionic={false} />);
    expect(unstamped).not.toContain('class="who"');
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
    const shown = renderToStaticMarkup(<Transcript transcript={transcript} view={all} />);
    expect(shown).toContain('class="tool"');
    expect(shown).toContain('class="system"');
    expect(shown).toContain('class="thinking"');
    const hidden = renderToStaticMarkup(<Transcript transcript={transcript} view={{ hideThinking: true, showTools: false, showSystem: false, bionic: false }} />);
    expect(hidden).not.toContain('class="tool"');
    expect(hidden).not.toContain('class="system"');
    expect(hidden).not.toContain('class="thinking"');
    expect(hidden).toContain('done');
    expect(blocks.filter((b) => visible(b, all))).toHaveLength(5);
  });
});
