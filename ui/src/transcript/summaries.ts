// One line per tool call. The line is what the reader sees before deciding to expand.

const clip = (value: unknown, max = 110): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
};

const str = (input: Record<string, unknown>, key: string): string => {
  const value = input[key];
  return typeof value === 'string' ? value : '';
};

const short = (path: string): string => path.replace(/^\/Users\/[^/]+/, '~');

type Summariser = (input: Record<string, unknown>) => string;

const byTool: Record<string, Summariser> = {
  Bash: (i) => clip(str(i, 'command').split('\n')[0]),
  Read: (i) => short(str(i, 'file_path')),
  Edit: (i) => short(str(i, 'file_path')),
  Write: (i) => short(str(i, 'file_path')),
  NotebookEdit: (i) => short(str(i, 'notebook_path')),
  Glob: (i) => [str(i, 'pattern'), short(str(i, 'path'))].filter(Boolean).join('  in  '),
  Grep: (i) => [str(i, 'pattern'), short(str(i, 'path'))].filter(Boolean).join('  in  '),
  Agent: (i) => str(i, 'description') || clip(str(i, 'prompt'), 80),
  WebSearch: (i) => str(i, 'query'),
  WebFetch: (i) => str(i, 'url'),
  ToolSearch: (i) => str(i, 'query'),
  Skill: (i) => [str(i, 'skill'), str(i, 'args')].filter(Boolean).join(' '),
  TodoWrite: () => 'update todo list',
  AskUserQuestion: () => 'question for the user',
};

export const toolDisplayName = (name: string): string => (name.startsWith('mcp__') ? name.split('__').slice(1).join(' / ') : name);

export const summarise = (name: string, input: Record<string, unknown>): string => {
  const specific = byTool[name];
  if (specific) return specific(input);
  return clip(input, 90);
};

export const countLines = (text: string): number => (text === '' ? 0 : text.split('\n').length);
