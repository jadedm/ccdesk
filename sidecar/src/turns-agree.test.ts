// The search reports the turn a hit is in; the UI renders those turns. Both sides read the
// same fixtures here: if they ever disagree about what opens a turn, this fails.
import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reduceAll } from '../../ui/src/transcript/reduce.ts';
import { searchFile } from './search.ts';

const user = (content: unknown, extra: Record<string, unknown> = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });
const assistant = (content: unknown[], extra: Record<string, unknown> = {}) => ({ type: 'assistant', message: { role: 'assistant', content }, ...extra });
const text = (t: string) => ({ type: 'text', text: t });

const shapes: Array<{ name: string; records: unknown[]; needle: string }> = [
  { name: 'plain prompts', records: [user('one apple'), assistant([text('a')]), user('two needlehere')], needle: 'needlehere' },
  { name: 'reminder before the prompt in one record', records: [user('one'), user([text('<system-reminder>noise</system-reminder>'), text('real needlehere prompt')])], needle: 'needlehere' },
  { name: 'empty first text part', records: [user('one'), user([text('   '), text('second needlehere')])], needle: 'needlehere' },
  { name: 'two prompts in one record', records: [user('one'), user([text('two'), text('three needlehere')])], needle: 'needlehere' },
  { name: 'transcript opening with a reply', records: [assistant([text('leading reply')]), user('then needlehere')], needle: 'needlehere' },
  { name: 'opening reply holds the hit', records: [assistant([text('leading needlehere')]), user('then a prompt')], needle: 'needlehere' },
  { name: 'shell input', records: [user('one'), user('<bash-input>grep needlehere src</bash-input>')], needle: 'needlehere' },
  { name: 'slash command is not a turn', records: [user('one'), user('<command-name>/model</command-name>'), user('after needlehere')], needle: 'needlehere' },
  { name: 'subagent text is invisible', records: [user('one needlehere'), assistant([text('sub needlehere')], { parent_tool_use_id: 'toolu_x' })], needle: 'needlehere' },
];

/** The rendered turn a snippet belongs to: the first turn whose text contains the needle. */
const renderedTurn = (records: unknown[], needle: string): number => {
  const t = reduceAll(records);
  const index = t.turns.findIndex((turn) => turn.blocks.some((b) => 'text' in b && b.text.toLowerCase().includes(needle)));
  return index + 1;
};

describe('search turns match rendered turns', () => {
  it.each(shapes)('agrees on $name', async ({ records, needle }) => {
    const dir = await mkdtemp(join(tmpdir(), 'ccdesk-agree-'));
    const file = join(dir, 's.jsonl');
    await writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const hit = await searchFile(file, needle);
    expect(hit).not.toBeNull();
    expect(hit!.turn).toBe(renderedTurn(records, needle));
  });
});
