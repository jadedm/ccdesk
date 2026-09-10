import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { DirectoryReport } from '../../../shared/protocol.ts';
import { basename, blockingReason, directoryNote, effectiveName, hasContent, rulesFor, type AddFields, type AddKind } from '../add-form.ts';
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
  workspace: 'A workspace is a directory on disk. Choose the project you run Claude Code in.',
  folder: 'A folder groups sessions. Give it its own directory to run its sessions somewhere else.',
  session: 'Leave the name blank and Claude Code will title the session from your first message.',
};

const short = (path: string): string => path.replace(/^\/Users\/[^/]+/, '~');

/** Add a workspace, folder or session. The directory is chosen first, because it is the real
 * decision and it supplies the name. Labelled fields, a cancel, and a stated reason when it
 * cannot save, instead of a greyed button that explains nothing. */
export const AddForm = ({ kind, defaultDirectory, describe, onSubmit, onCancel, onContentChange }: AddFormProps) => {
  const rules = rulesFor(kind);
  const id = useId();
  const [fields, setFields] = useState<AddFields>({ name: '', cwd: '' });
  const [report, setReport] = useState<DirectoryReport | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const first = useRef<HTMLButtonElement | HTMLInputElement>(null);
  const native = hasNativeDialog();

  useEffect(() => first.current?.focus(), []);
  useEffect(() => onContentChange?.(hasContent(fields)), [fields, onContentChange]);

  // What the chosen directory actually is, asked for as it changes.
  useEffect(() => {
    const path = fields.cwd.trim();
    if (!describe || !path.startsWith('/')) {
      setReport(null);
      setPending(false);
      return;
    }
    setPending(true);
    let current = true;
    const timer = setTimeout(() => {
      void describe(path)
        .then((r) => current && (setReport(r), setPending(false)))
        .catch(() => current && (setReport(null), setPending(false)));
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [fields.cwd, describe]);

  const reason = blockingReason(rules, fields, { report, pending });
  const note = directoryNote(report);
  const chosen = fields.cwd.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (reason) return;
    onSubmit({ name: effectiveName(fields), cwd: chosen });
  };

  /** Picking a directory names the thing too, unless the user has typed a name already. */
  const choose = async () => {
    const picked = await pickDirectory(chosen || defaultDirectory);
    if (!picked) return;
    setFields((f) => ({ cwd: picked, name: f.name.trim() === '' ? basename(picked) : f.name }));
  };

  return (
    <form className="addform" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onCancel()} aria-label={titles[kind]}>
      <div className="addform-title">{titles[kind]}</div>
      <p className="addform-hint">{hints[kind]}</p>

      {rules.directory !== 'none' && (
        <>
          <label htmlFor={native ? undefined : `${id}-cwd`}>Directory{rules.directory === 'optional' ? ' (optional)' : ''}</label>
          {native ? (
            <>
              <button
                type="button"
                ref={first as React.RefObject<HTMLButtonElement>}
                className={chosen ? 'btn addform-choose' : 'btn primary addform-choose'}
                onClick={() => void choose()}
              >
                {chosen ? `Change directory (${short(chosen)})` : 'Choose directory…'}
              </button>
              {rules.directory === 'optional' && chosen !== '' && (
                <button type="button" className="addform-clear" onClick={() => setFields((f) => ({ ...f, cwd: '' }))}>Use the workspace directory instead</button>
              )}
            </>
          ) : (
            <>
              <input id={`${id}-cwd`} ref={first as React.RefObject<HTMLInputElement>} value={fields.cwd} placeholder="/full/path" onChange={(e) => setFields((f) => ({ cwd: e.target.value, name: f.name }))} onBlur={() => setFields((f) => (f.name.trim() === '' ? { ...f, name: basename(f.cwd) } : f))} />
              <div className="addform-note">The desktop app opens a folder picker here. A browser cannot read a real path, so type or paste one.</div>
            </>
          )}
          {chosen !== '' && !native && <div className="addform-path">{short(chosen)}</div>}
          {note && <div className={note.tone === 'warn' ? 'addform-note warn' : 'addform-note'}>{note.text}</div>}
        </>
      )}

      <label htmlFor={`${id}-name`}>Name{rules.nameRequired && rules.directory === 'none' ? '' : ' (optional)'}</label>
      <input
        id={`${id}-name`}
        ref={rules.directory === 'none' ? (first as React.RefObject<HTMLInputElement>) : undefined}
        value={fields.name}
        placeholder={chosen ? basename(chosen) : undefined}
        onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
      />

      {submitted && reason && <div className="addform-note warn" role="alert">{reason}</div>}

      <div className="addform-actions">
        <button type="submit" className="btn primary">Create</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
};
