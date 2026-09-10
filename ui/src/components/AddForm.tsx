import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { DirectoryReport } from '../../../shared/protocol.ts';
import { directoryNote, hasContent, reasonNotReady, rulesFor, type AddFields, type AddKind } from '../add-form.ts';
import { hasNativeDialog, pickDirectory } from '../pick.ts';

export type AddFormProps = {
  kind: AddKind;
  defaultDirectory?: string;
  describe?: (path: string) => Promise<DirectoryReport>;
  onSubmit: (fields: AddFields) => void;
  onCancel: () => void;
  /** Lets the parent ask before replacing a form that holds typing. */
  onContentChange?: (hasText: boolean) => void;
};

const titles: Record<AddKind, string> = { workspace: 'New workspace', folder: 'New folder', session: 'New session' };
const hints: Record<AddKind, string> = {
  workspace: 'A workspace is a directory on disk. Point it at the project you run Claude Code in.',
  folder: 'A folder groups sessions. Give it its own directory to run its sessions somewhere else.',
  session: 'Leave the name blank and Claude Code will title the session from your first message.',
};

const short = (path: string): string => path.replace(/^\/Users\/[^/]+/, '~');

/** Add a workspace, folder or session. Labelled fields, a cancel, and a reason when it cannot
 * save yet, instead of a greyed button that explains nothing. */
export const AddForm = ({ kind, defaultDirectory, describe, onSubmit, onCancel, onContentChange }: AddFormProps) => {
  const rules = rulesFor(kind);
  const id = useId();
  const [fields, setFields] = useState<AddFields>({ name: '', cwd: '' });
  const [report, setReport] = useState<DirectoryReport | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => firstField.current?.focus(), []);
  useEffect(() => onContentChange?.(hasContent(fields)), [fields, onContentChange]);

  // What the chosen directory actually is, asked for as it is typed.
  useEffect(() => {
    const path = fields.cwd.trim();
    if (!describe || !path.startsWith('/')) {
      setReport(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      void describe(path).then((r) => current && setReport(r)).catch(() => current && setReport(null));
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [fields.cwd, describe]);

  const reason = reasonNotReady(rules, fields);
  const note = directoryNote(report);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (reason) return;
    onSubmit({ name: fields.name.trim(), cwd: fields.cwd.trim() });
  };

  const choose = async () => {
    const chosen = await pickDirectory(fields.cwd || defaultDirectory);
    if (chosen) setFields((f) => ({ ...f, cwd: chosen }));
  };

  return (
    <form className="addform" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onCancel()} aria-label={titles[kind]}>
      <div className="addform-title">{titles[kind]}</div>
      <p className="addform-hint">{hints[kind]}</p>

      <label htmlFor={`${id}-name`}>Name{rules.nameRequired ? '' : ' (optional)'}</label>
      <input id={`${id}-name`} ref={firstField} value={fields.name} onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))} />

      {rules.directory !== 'none' && (
        <>
          <label htmlFor={`${id}-cwd`}>Directory{rules.directory === 'optional' ? ' (optional)' : ''}</label>
          <div className="addform-dir">
            <input id={`${id}-cwd`} value={fields.cwd} placeholder="/full/path" onChange={(e) => setFields((f) => ({ ...f, cwd: e.target.value }))} />
            {hasNativeDialog() && <button type="button" className="btn" onClick={() => void choose()}>Choose…</button>}
          </div>
          {fields.cwd.trim() !== '' && <div className="addform-path">{short(fields.cwd.trim())}</div>}
          {note && <div className={note.tone === 'warn' ? 'addform-note warn' : 'addform-note'}>{note.text}</div>}
        </>
      )}

      {submitted && reason && <div className="addform-note warn" role="alert">{reason}</div>}

      <div className="addform-actions">
        <button type="submit" className="btn primary">Create</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
};
