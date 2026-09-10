// What an add form will accept, and why it will not. The form shows the reason rather than
// greying a button and saying nothing.

export type AddKind = 'workspace' | 'folder' | 'session';

export type AddFields = { name: string; cwd: string };

export type AddRules = { nameRequired: boolean; directory: 'required' | 'optional' | 'none' };

export const rulesFor = (kind: AddKind): AddRules => {
  const byKind: Record<AddKind, AddRules> = {
    workspace: { nameRequired: true, directory: 'required' },
    folder: { nameRequired: true, directory: 'optional' },
    session: { nameRequired: false, directory: 'none' },
  };
  return byKind[kind];
};

/** The reason this cannot be saved yet, or null when it can. Shown to the user as written. */
export const reasonNotReady = (rules: AddRules, fields: AddFields): string | null => {
  const name = fields.name.trim();
  const cwd = fields.cwd.trim();
  if (rules.nameRequired && name === '') return 'Give it a name.';
  if (rules.directory === 'required' && cwd === '') return 'Choose the directory this workspace covers.';
  if (cwd !== '' && !cwd.startsWith('/')) return 'The directory must be a full path, starting with a slash.';
  return null;
};

/** What the directory report means for someone about to save. */
export const directoryNote = (report: { exists: boolean; isDirectory: boolean; sessions: number } | null): { text: string; tone: 'info' | 'warn' } | null => {
  if (!report) return null;
  if (!report.exists) return { text: 'No such directory. Check the path before saving.', tone: 'warn' };
  if (!report.isDirectory) return { text: 'That is a file, not a directory.', tone: 'warn' };
  if (report.sessions === 0) return { text: 'No Claude Code sessions here yet. New ones will be created in it.', tone: 'info' };
  return { text: `${report.sessions} Claude Code session${report.sessions === 1 ? '' : 's'} already here.`, tone: 'info' };
};

export const hasContent = (fields: AddFields): boolean => fields.name.trim() !== '' || fields.cwd.trim() !== '';
