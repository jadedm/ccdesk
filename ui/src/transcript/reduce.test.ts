import { describe, expect, it } from 'vitest';
import { reduceAll, reduceRecord } from './reduce.ts';
import { summarise } from './summaries.ts';
import { emptyTranscript } from './blocks.ts';

const user = (content: unknown, extra: Record<string, unknown> = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });
const assistant = (content: unknown[]) => ({ type: 'assistant', message: { role: 'assistant', model: 'claude-test', content } });

const history = [
    user('list the files'),
    assistant([{ type: 'thinking', thinking: 'I should run ls' }]),
    assistant([{ type: 'text', text: 'Listing now.' }]),
    assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la /tmp' } }]),
    user([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a\nb\nc' }]),
    assistant([{ type: 'text', text: 'Three files.' }]),
  ];

const live = [
    user('list the files'),
    { type: 'system', subtype: 'init', model: 'claude-test', claude_code_version: '2.1.266' },
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'I should run ls' } } },
    assistant([{ type: 'thinking', thinking: 'I should run ls' }]),
    { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Listing ' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'now.' } } },
    assistant([{ type: 'text', text: 'Listing now.' }]),
    { type: 'stream_event', event: { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} } } },
    assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la /tmp' } }]),
    user([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a\nb\nc' }]),
    assistant([{ type: 'text', text: 'Three files.' }]),
    { type: 'result', subtype: 'success', is_error: false },
  ];

describe('reduce: history and live agree', () => {
  const strip = (t: ReturnType<typeof reduceAll>) =>
    t.turns.map((turn) => turn.blocks.map((b) => {
      const { id: _id, at: _at, ...rest } = b as Record<string, unknown>;
      return rest;
    }));

  it('produces the same blocks from history records and from live messages', () => {
    const fromHistory = reduceAll(history);
    const fromLive = live.reduce((t, r) => reduceRecord(t, r), emptyTranscript());
    expect(strip(fromLive)).toEqual(strip(fromHistory));
    expect(fromLive.turns).toHaveLength(1);
    const kinds = fromLive.turns[0].blocks.map((b) => b.kind);
    expect(kinds).toEqual(['user', 'thinking', 'text', 'tool', 'text']);
  });

  it('appends text deltas to the open text block and pairs tool results by id', () => {
    const t = live.slice(0, 8).reduce((acc, r) => reduceRecord(acc, r), emptyTranscript());
    const text = t.turns[0].blocks.find((b) => b.kind === 'text');
    expect(text && text.kind === 'text' && text.text).toBe('Listing now.');
    expect(text && text.kind === 'text' && text.streaming).toBe(true);
    const full = live.reduce((acc, r) => reduceRecord(acc, r), emptyTranscript());
    const tool = full.turns[0].blocks.find((b) => b.kind === 'tool');
    expect(tool && tool.kind === 'tool' && tool.result).toEqual({ text: 'a\nb\nc', isError: false, lines: 3 });
    expect(tool && tool.kind === 'tool' && tool.summary).toBe('ls -la /tmp');
    expect(full.model).toBe('claude-test');
  });

  it('leaves the previous state untouched, so applying a record twice gives the same result', () => {
    const before = live.slice(0, 8).reduce((acc, r) => reduceRecord(acc, r), emptyTranscript());
    const frozen = JSON.stringify(before);
    const once = reduceRecord(before, live[8]);
    const twice = reduceRecord(before, live[8]);
    expect(JSON.stringify(before)).toBe(frozen);
    expect(once.turns[0].blocks.filter((b) => b.kind === 'text')).toHaveLength(1);
    expect(twice.turns[0].blocks.filter((b) => b.kind === 'text')).toHaveLength(1);
    const delta = live[7];
    const d1 = reduceRecord(before, delta);
    const d2 = reduceRecord(before, delta);
    const textOf = (t: typeof before) => t.turns[0].blocks.find((b) => b.kind === 'text');
    expect(textOf(d1)).toEqual(textOf(d2));
    expect(textOf(d1)?.text).toBe('Listing now.now.');
  });

  it('starts a new turn per user prompt and reports failed results', () => {
    const t = reduceAll([user('one'), assistant([{ type: 'text', text: 'a' }]), user('two'), { type: 'result', is_error: true, result: 'boom' }]);
    expect(t.turns).toHaveLength(2);
    expect(t.turns[1].blocks.map((b) => b.kind)).toEqual(['user', 'note']);
  });
});

describe('reduce: live and history stay aligned in the awkward cases', () => {
  it('drops subagent traffic from the live view, as the session store does from history', () => {
    const sub = { type: 'assistant', parent_tool_use_id: 'toolu_agent', message: { role: 'assistant', content: [{ type: 'text', text: 'inner monologue' }] } };
    const subStream = { type: 'stream_event', parent_tool_use_id: 'toolu_agent', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'leak' } } };
    const t = [user('go'), { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } }, sub, subStream]
      .reduce((acc, r) => reduceRecord(acc, r), emptyTranscript());
    const texts = t.turns[0].blocks.filter((b) => b.kind === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0].kind === 'text' && texts[0].text).toBe('');
  });

  it('closes an unanswered tool call when history ends, so it does not show as running', () => {
    const t = reduceAll([user('x'), assistant([{ type: 'tool_use', id: 'toolu_9', name: 'Bash', input: { command: 'sleep 100' } }])]);
    const tool = t.turns[0].blocks.find((b) => b.kind === 'tool');
    expect(tool && tool.kind === 'tool' && tool.streaming).toBe(false);
    expect(tool && tool.kind === 'tool' && tool.result).toBeUndefined();
  });

  it('shares unchanged blocks between states and copies only what changed', () => {
    const before = live.slice(0, 7).reduce((acc, r) => reduceRecord(acc, r), emptyTranscript());
    const after = reduceRecord(before, live[7]);
    expect(after.turns[0].blocks[0]).toBe(before.turns[0].blocks[0]);
    expect(after.turns[0].blocks[1]).toBe(before.turns[0].blocks[1]);
    expect(after.turns[0].blocks[2]).not.toBe(before.turns[0].blocks[2]);
  });
});

describe('summaries', () => {
  it('shows the command, the path, the description or the tool name', () => {
    expect(summarise('Bash', { command: 'grep -n foo src/\nmore', description: 'x' })).toBe('grep -n foo src/');
    expect(summarise('Read', { file_path: '/Users/ada/proj/a.ts' })).toBe('~/proj/a.ts');
    expect(summarise('Edit', { file_path: '/x/b.ts', old_string: 'a', new_string: 'b' })).toBe('/x/b.ts');
    expect(summarise('Write', { file_path: '/x/c.ts', content: 'zzz' })).toBe('/x/c.ts');
    expect(summarise('Agent', { description: 'Find callers', prompt: 'long prompt' })).toBe('Find callers');
    expect(summarise('WebSearch', { query: 'tauri sidecar' })).toBe('tauri sidecar');
    expect(summarise('Grep', { pattern: 'foo', path: '/x' })).toBe('foo  in  /x');
    expect(summarise('SomethingNew', { a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}');
    expect(summarise('Bash', { command: 'x'.repeat(300) }).length).toBeLessThanOrEqual(110);
  });
});

describe('noise filter', () => {
  it('produces no blocks for bookkeeping records and meta user records', () => {
    const noise = [
      { type: 'system', subtype: 'turn_duration', durationMs: 10 },
      { type: 'system', subtype: 'stop_hook_summary', level: 'suggestion' },
      { type: 'file-history-snapshot', snapshot: {} },
      { type: 'ai-title', aiTitle: 'x' },
      { type: 'last-prompt', lastPrompt: 'x' },
      { type: 'attachment', attachment: { type: 'environment' } },
      user([{ type: 'text', text: '[Image: source: /x.png]' }], { isMeta: true }),
      user('Stop hook feedback: nope', { isMeta: true }),
    ];
    expect(reduceAll(noise).turns).toEqual([]);
  });

  it('folds harness-injected user turns into tagged system blocks instead of dropping them', () => {
    const t = reduceAll([
      user('go'),
      user('<system-reminder>\nremember the rules\n</system-reminder>'),
      user('<task-notification>\n<task-id>abc</task-id>\n</task-notification>'),
      user('<local-command-caveat>Caveat</local-command-caveat>'),
    ]);
    const blocks = t.turns[0].blocks;
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'system', 'system', 'system']);
    expect(blocks[1]).toMatchObject({ kind: 'system', tag: 'system-reminder', text: 'remember the rules' });
    expect(blocks[2]).toMatchObject({ kind: 'system', tag: 'task-notification' });
    expect(blocks[3]).toMatchObject({ kind: 'system', tag: 'local-command-caveat', text: 'Caveat' });
    const quoted = reduceAll([user('x'), user('<system-reminder>\nuse <br> not <div class="x">\n</system-reminder>')]);
    expect(quoted.turns[0].blocks[1]).toMatchObject({ kind: 'system', text: 'use <br> not <div class="x">' });
  });

  it('stamps a live reply with the clock when the stream starts', () => {
    const before = Date.now() - 1000;
    const t = [user('hi'), { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } }]
      .reduce((acc, r) => reduceRecord(acc, r), emptyTranscript());
    const at = t.turns[0].replyAt;
    expect(at).toBeTruthy();
    expect(new Date(at!).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('carries record timestamps onto the user block and the first reply block of a turn', () => {
    const t = reduceAll([
      { ...user('hi'), timestamp: '2026-09-09T10:00:00Z' },
      { ...assistant([{ type: 'thinking', thinking: 'hm' }]), timestamp: '2026-09-09T10:00:05Z' },
      { ...assistant([{ type: 'text', text: 'hello' }]), timestamp: '2026-09-09T10:00:09Z' },
      user('no stamp'),
      assistant([{ type: 'text', text: 'none' }]),
    ]);
    const [first, second] = t.turns;
    expect(first.blocks[0]).toMatchObject({ kind: 'user', at: '2026-09-09T10:00:00Z' });
    expect(first.replyAt).toBe('2026-09-09T10:00:05Z');
    expect('at' in second.blocks[0] && second.blocks[0].at).toBeFalsy();
    expect(second.replyAt).toBeUndefined();
  });

  it('renders slash commands and shell input as notes and prompts', () => {
    const t = reduceAll([user('<command-name>/model</command-name><command-message>model</command-message>'), user('<bash-input>ls</bash-input>')]);
    const blocks = t.turns.flatMap((x) => x.blocks);
    expect(blocks[0]).toMatchObject({ kind: 'note', text: 'ran /model' });
    expect(blocks[1]).toMatchObject({ kind: 'user', text: '! ls' });
  });
});
