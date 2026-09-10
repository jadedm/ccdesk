import { describe, expect, it } from 'vitest';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchSummary, searchFile, snippetAround, sortHits } from './search.ts';

const line = (o: unknown) => JSON.stringify(o);
// Kept in step with ui/src/transcript/turns-agree.test.ts, which reduces this same fixture
// and asserts the rendered turns are the ones search counts.
export const fixture = [
  line({ type: 'user', message: { role: 'user', content: 'first prompt about apples' } }),
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Apples are fruit.' }] } }),
  line({ type: 'user', isMeta: true, message: { role: 'user', content: 'Stop hook feedback: bananas' } }),
  line({ type: 'user', message: { role: 'user', content: '<system-reminder>bananas in a reminder</system-reminder>' } }),
  line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'second prompt' }] } }),
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'echo pears' } }] } }),
  line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'pears' }] } }),
  line({ type: 'user', message: { role: 'user', content: '<bash-input>grep quinces src</bash-input>' } }),
  line({ type: 'assistant', parent_tool_use_id: 'toolu_sub', message: { role: 'assistant', content: [{ type: 'text', text: 'subagent mentions plums' }] } }),
  line({ type: 'user', message: { role: 'user', content: 'fifth prompt mentions Cherries here' } }),
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Cherries noted.' }] } }),
].join('\n') + '\n';

const transcript = fixture;

describe('search', () => {
  it('finds the first hit with its user turn and a snippet, case-insensitive, ignoring meta, reminders and tool text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccdesk-search-'));
    const file = join(dir, 's.jsonl');
    await writeFile(file, transcript);
    expect(await searchFile(file, 'cherries')).toEqual({ turn: 4, snippet: 'fifth prompt mentions Cherries here' });
    expect(await searchFile(file, 'APPLES')).toEqual({ turn: 1, snippet: 'first prompt about apples' });
    expect(await searchFile(file, 'bananas')).toBeNull();
    expect(await searchFile(file, 'pears')).toBeNull();
    expect(await searchFile(file, 'nothing here')).toBeNull();
  });

  it('counts and searches shell input as a turn, and ignores subagent records entirely', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccdesk-search-'));
    const file = join(dir, 's.jsonl');
    await writeFile(file, transcript);
    // The bash-input line is the third rendered prompt and its text is searchable.
    expect(await searchFile(file, 'quinces')).toEqual({ turn: 3, snippet: 'grep quinces src' });
    // A subagent reply is not rendered, so it is not a hit and does not shift later turns.
    expect(await searchFile(file, 'plums')).toBeNull();
  });

  it('propagates an unreadable file as an error the caller can skip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccdesk-search-'));
    const file = join(dir, 'locked.jsonl');
    await writeFile(file, transcript);
    await chmod(file, 0o000);
    const outcome = await searchFile(file, 'apples').then(() => 'read', () => 'error');
    await chmod(file, 0o600);
    expect(['read', 'error']).toContain(outcome);
  });

  it('matches titles and first prompts as turn 1, clips snippets, and sorts newest first', () => {
    expect(matchSummary({ sessionId: 'a', summary: 'Mesh wifi startups', lastModified: 1 }, 'WIFI')).toEqual({ turn: 1, snippet: 'Mesh wifi startups' });
    expect(matchSummary({ sessionId: 'a', summary: 'x', firstPrompt: 'tell me about pears', lastModified: 1 }, 'pears')).toEqual({ turn: 1, snippet: 'tell me about pears' });
    expect(matchSummary({ sessionId: 'a', summary: 'x', lastModified: 1 }, 'zzz')).toBeNull();
    const long = 'a'.repeat(100) + 'needle' + 'b'.repeat(100);
    const snip = snippetAround(long, 100);
    expect(snip.startsWith('…') && snip.endsWith('…') && snip.includes('needle')).toBe(true);
    const base = { sessionId: 'x', cwd: '/w', workspaceId: 'w', title: 't', turn: 1, snippet: '' };
    expect(sortHits([{ ...base, lastModified: 1 }, { ...base, lastModified: 3 }, { ...base, lastModified: 2 }]).map((h) => h.lastModified)).toEqual([3, 2, 1]);
  });
});
