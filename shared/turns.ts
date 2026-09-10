// What counts as conversation in a transcript, and what is harness machinery. One rule set,
// used by the UI reducer that renders transcripts and by the sidecar search that indexes
// them, so a search hit's turn number always matches the turn the reader is scrolled to.

/** Wrappers the CLI injects as user records. Folded away in the UI, never searched. */
export const MACHINERY_TAGS = [
  'system-reminder',
  'task-notification',
  'local-command-caveat',
  'local-command-stdout',
  'local-command-stderr',
  'command-message',
  'command-args',
  'command-contents',
  'command-stdout',
  'command-stderr',
  'user-prompt-submit-hook',
  'bash-stdout',
  'bash-stderr',
] as const;

export const machineryTag = (text: string): string | null => {
  const match = text.trimStart().match(new RegExp(`^<(${MACHINERY_TAGS.join('|')})\\b`));
  return match ? match[1] : null;
};

/** `<command-name>/model</command-name>` renders as a note, not a prompt, so it starts no turn. */
export const isSlashCommand = (text: string): boolean => /^<command-name>/.test(text.trimStart());

/** `<bash-input>ls</bash-input>` renders as a user prompt and does start a turn. */
export const bashInput = (text: string): string | null => {
  const match = text.trimStart().match(/^<bash-input>([\s\S]*?)<\/bash-input>/);
  return match ? match[1].trim() : null;
};

/** True when a user text record is a prompt the reader sees, which is what numbers the turns. */
export const startsTurn = (text: string, isMeta = false): boolean => {
  if (isMeta || text.trim() === '') return false;
  if (bashInput(text) !== null) return true;
  return machineryTag(text) === null && !isSlashCommand(text) && !text.trimStart().startsWith('[Request interrupted');
};
