// The sidecar's search reports the turn a hit is in; the transcript renders those turns.
// This fixture is the one in sidecar/src/search.test.ts: if the two sides ever disagree about
// what starts a turn, one of these numbers moves and this test fails.
import { describe, expect, it } from 'vitest';
import { reduceAll } from './reduce.ts';

const line = (o: unknown) => JSON.parse(JSON.stringify(o)) as unknown;
const records = [
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
];

describe('search turns match rendered turns', () => {
  it('renders four turns, with shell input third and the cherries prompt fourth', () => {
    const t = reduceAll(records);
    const prompts = t.turns.map((turn) => {
      const first = turn.blocks.find((b) => b.kind === 'user');
      return first && first.kind === 'user' ? first.text : null;
    });
    expect(prompts).toEqual(['first prompt about apples', 'second prompt', '! grep quinces src', 'fifth prompt mentions Cherries here']);
    // The reminder folds into turn 1 and the subagent reply is absent everywhere.
    expect(t.turns[0].blocks.some((b) => b.kind === 'system')).toBe(true);
    expect(JSON.stringify(t)).not.toContain('plums');
  });
});
