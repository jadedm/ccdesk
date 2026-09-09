import { useState, type FormEvent } from 'react';
import type { IndexFolder, IndexWorkspace, WorkspaceIndex } from '../../../shared/protocol.ts';
import type { ListedSession } from '../cwd.ts';
import { metaLine, type RowMeta } from '../meta.ts';
import { hasNativeDialog, pickDirectory } from '../pick.ts';
import type { SessionView } from '../state.ts';

export type TreeProps = {
  index: WorkspaceIndex | null;
  unfiled: Record<string, ListedSession[]>;
  sessions: Record<string, SessionView>;
  activeKey: string | null;
  onCreateWorkspace: (name: string, cwd: string) => void;
  onCreateFolder: (workspaceId: string, name: string, cwd: string | null) => void;
  onNewSession: (workspace: IndexWorkspace, folder: IndexFolder, title: string) => void;
  onOpenSession: (workspace: IndexWorkspace, folder: IndexFolder | null, sessionId: string, title: string, listedIn?: string) => void;
};

const short = (path: string): string => path.replace(/^\/Users\/[^/]+/, '~');

const chooseLabel = { required: 'choose directory', optional: 'directory (optional)' } as const;

type NameFormProps = {
  placeholder: string;
  onSubmit: (name: string, cwd: string) => void;
  onCancel: () => void;
  /** 'required' shows the directory field and needs a value; 'optional' shows it and allows empty. */
  directory?: 'required' | 'optional';
  defaultDirectory?: string;
  /** An empty name is allowed; the caller decides what that means. */
  nameOptional?: boolean;
};

// Name plus, when asked for, a directory. Inside Tauri the directory comes from the native
// picker; in a browser it is typed.
const NameForm = ({ placeholder, onSubmit, onCancel, directory, defaultDirectory, nameOptional }: NameFormProps) => {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const native = hasNativeDialog();
  const nameOk = nameOptional || name.trim() !== '';
  const cwdOk = (directory !== 'required' || cwd.trim().startsWith('/')) && (cwd.trim() === '' || cwd.trim().startsWith('/'));
  const valid = nameOk && cwdOk;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSubmit(name.trim(), cwd.trim());
  };
  const choose = async () => {
    const chosen = await pickDirectory(cwd || defaultDirectory);
    if (chosen) setCwd(chosen);
  };
  const escape = (e: React.KeyboardEvent) => e.key === 'Escape' && onCancel();
  return (
    <form onSubmit={submit} className="nameform">
      <input autoFocus placeholder={placeholder} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={escape} aria-label={placeholder} />
      {directory && native && (
        <button type="button" className="mini" onClick={() => void choose()} title={cwd || 'choose a directory'}>
          {cwd ? short(cwd) : chooseLabel[directory]}
        </button>
      )}
      {directory && !native && (
        <input placeholder={directory === 'required' ? '/absolute/path' : '/absolute/path (optional)'} value={cwd} onChange={(e) => setCwd(e.target.value)} onKeyDown={escape} aria-label="directory" />
      )}
      <button className="mini" type="submit" title="save" disabled={!valid}>ok</button>
    </form>
  );
};

const liveFor = (sessions: Record<string, SessionView>, sessionId: string): SessionView | undefined =>
  Object.values(sessions).find((s) => s.sessionId === sessionId && s.status !== 'history');

const SessionRow = ({ id, title, meta, sessions, activeKey, onOpen }: { id: string; title: string; meta: RowMeta; sessions: Record<string, SessionView>; activeKey: string | null; onOpen: () => void }) => {
  const live = liveFor(sessions, id);
  const viewing = Object.values(sessions).find((s) => s.sessionId === id);
  const active = viewing !== undefined && viewing.key === activeKey;
  const dotClass = live ? `dot ${live.status}` : 'dot';
  const line = live ? (live.status === 'running' ? 'working' : live.status) : metaLine(meta);
  return (
    <div className={`row session selectable${active ? ' active' : ''}`} onClick={onOpen} title={id}>
      <span className={dotClass} />
      <span className="label">
        <span className="st">{title}</span>
        {line && <span className="sm">{line}</span>}
      </span>
    </div>
  );
};

export const Tree = (p: TreeProps) => {
  const [adding, setAdding] = useState<string | null>(null);
  const filedIds = new Set(p.index?.workspaces.flatMap((w) => w.folders.flatMap((f) => f.sessions.map((s) => s.sessionId))) ?? []);
  const titleOf = (id: string, ws: IndexWorkspace): string => {
    const known = p.unfiled[ws.id]?.find((s) => s.sessionId === id);
    const live = Object.values(p.sessions).find((s) => s.sessionId === id);
    return live?.title || known?.customTitle || known?.summary || known?.firstPrompt || id.slice(0, 8);
  };
  const metaOf = (id: string, ws: IndexWorkspace): RowMeta => p.unfiled[ws.id]?.find((s) => s.sessionId === id) ?? {};
  const unfiledOf = (ws: IndexWorkspace): ListedSession[] => (p.unfiled[ws.id] ?? []).filter((s) => !filedIds.has(s.sessionId));
  return (
    <aside className="rail">
      <h1>Workspaces</h1>
      {p.index?.workspaces.map((ws) => {
        const unfiled = unfiledOf(ws);
        return (
        <div className="workspace" key={ws.id}>
          <div className="row">
            <span className="label">{ws.name}</span>
            <button className="mini" title="new folder" onClick={() => setAdding(`folder:${ws.id}`)}>+ folder</button>
          </div>
          <div className="cwd" title={ws.cwd}>{short(ws.cwd)}</div>
          {adding === `folder:${ws.id}` && (
            <NameForm placeholder="folder name" directory="optional" defaultDirectory={ws.cwd} onCancel={() => setAdding(null)} onSubmit={(name, cwd) => { p.onCreateFolder(ws.id, name, cwd || null); setAdding(null); }} />
          )}
          {ws.folders.map((folder) => (
            <div className="folder" key={folder.id}>
              <div className="row">
                <span className="label">{folder.name}</span>
                <button className="mini" title="new session" onClick={() => setAdding(`session:${folder.id}`)}>+ session</button>
              </div>
              {folder.cwd && <div className="cwd" title={folder.cwd}>{short(folder.cwd)}</div>}
              {adding === `session:${folder.id}` && (
                <NameForm placeholder="session name (blank lets the CLI title it)" nameOptional onCancel={() => setAdding(null)} onSubmit={(name) => { p.onNewSession(ws, folder, name); setAdding(null); }} />
              )}
              {folder.sessions.map((s) => (
                <SessionRow key={s.sessionId} id={s.sessionId} title={titleOf(s.sessionId, ws)} meta={metaOf(s.sessionId, ws)} sessions={p.sessions} activeKey={p.activeKey} onOpen={() => p.onOpenSession(ws, folder, s.sessionId, titleOf(s.sessionId, ws))} />
              ))}
              {folder.sessions.length === 0 && adding !== `session:${folder.id}` && <div className="row session muted">empty</div>}
            </div>
          ))}
          {unfiled.length > 0 && (
            <div className="folder">
              <div className="row"><span className="label muted">Unfiled</span></div>
              {unfiled.map((s) => (
                <SessionRow key={s.sessionId} id={s.sessionId} title={s.customTitle || s.summary || s.firstPrompt || s.sessionId.slice(0, 8)} meta={s} sessions={p.sessions} activeKey={p.activeKey} onOpen={() => p.onOpenSession(ws, null, s.sessionId, s.customTitle || s.summary || s.sessionId.slice(0, 8), s.listedIn)} />
              ))}
            </div>
          )}
        </div>
        );
      })}
      {adding === 'workspace' ? (
        <NameForm placeholder="workspace name" directory="required" onCancel={() => setAdding(null)} onSubmit={(name, cwd) => { p.onCreateWorkspace(name, cwd); setAdding(null); }} />
      ) : (
        <div className="row"><button className="mini" onClick={() => setAdding('workspace')}>+ workspace</button></div>
      )}
    </aside>
  );
};
