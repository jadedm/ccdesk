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
/** The directory comes first because it is the primary choice, and it supplies the name. */
export const reasonNotReady = (rules: AddRules, fields: AddFields): string | null => {
  const name = fields.name.trim();
  const cwd = fields.cwd.trim();
  if (rules.directory === 'required' && cwd === '') return 'Choose the directory this workspace covers.';
  if (cwd !== '' && !cwd.startsWith('/')) return 'The directory must be a full path, starting with a slash.';
  if (rules.nameRequired && name === '') return 'Give it a name.';
  return null;
};

export type Report = { exists: boolean; isDirectory: boolean; readable: boolean; sessions: number; problem: 'missing' | 'not-a-directory' | 'unreadable' | null };

/** What the directory report means for someone about to save. An unreadable directory is
 * reported, not refused: on macOS that is usually a permission prompt away. */
export const directoryNote = (report: Report | null): { text: string; tone: 'info' | 'warn' } | null => {
  if (!report) return null;
  if (report.problem === 'missing') return { text: 'No such directory. Check the path before saving.', tone: 'warn' };
  if (report.problem === 'not-a-directory') return { text: 'That is a file, not a directory.', tone: 'warn' };
  if (report.problem === 'unreadable') return { text: 'Cannot read that directory yet. macOS may ask for permission the first time it is used.', tone: 'warn' };
  if (report.sessions === 0) return { text: 'No Claude Code sessions here yet. New ones will be created in it.', tone: 'info' };
  return { text: `${report.sessions} Claude Code session${report.sessions === 1 ? '' : 's'} already here.`, tone: 'info' };
};

export const hasContent = (fields: AddFields): boolean => fields.name.trim() !== '' || fields.cwd.trim() !== '';

/** The last segment of a path, which is the name most people would give the directory. */
export const basename = (path: string): string => path.trim().replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? '';

/** The name that will be saved: what was typed, or the directory's own name. */
export const effectiveName = (fields: AddFields): string => (fields.name.trim() !== '' ? fields.name.trim() : basename(fields.cwd));

export type DirectoryState = { report: Report | null; pending: boolean };

/** Everything standing between the user and a save, in the order they should hear it. A
 * directory that does not exist blocks the save; the report is not merely advisory. */
export const blockingReason = (rules: AddRules, fields: AddFields, dir: DirectoryState): string | null => {
  const syntax = reasonNotReady(rules, { ...fields, name: effectiveName(fields) });
  if (syntax) return syntax;
  if (fields.cwd.trim() === '') return null;
  if (dir.pending) return 'Checking that directory…';
  if (!dir.report) return null;
  if (dir.report.problem === 'missing') return 'No such directory. Check the path before saving.';
  if (dir.report.problem === 'not-a-directory') return 'That is a file, not a directory.';
  // 'unreadable' is reported by directoryNote but does not block: it is usually a permission
  // prompt away, and refusing it would refuse the user's own Documents folder.
  return null;
};
