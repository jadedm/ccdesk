import { useState, type FormEvent } from 'react';
import type { IndexFolder, IndexWorkspace, SessionSummary, WorkspaceIndex } from '../../../shared/protocol.ts';
import type { SessionView } from '../state.ts';

export type TreeProps = {
  index: WorkspaceIndex | null;
  unfiled: Record<string, SessionSummary[]>;
  sessions: Record<string, SessionView>;
  activeKey: string | null;
  onCreateWorkspace: (name: string, cwd: string) => void;
  onCreateFolder: (workspaceId: string, name: string) => void;
  onNewSession: (workspace: IndexWorkspace, folder: IndexFolder) => void;
  onOpenSession: (workspace: IndexWorkspace, folder: IndexFolder | null, sessionId: string, title: string) => void;
};

const short = (path: string): string => path.replace(/^\/Users\/[^/]+/, '~');

const NameForm = ({ placeholder, onSubmit, onCancel, withCwd }: { placeholder: string; onSubmit: (name: string, cwd: string) => void; onCancel: () => void; withCwd?: boolean }) => {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() === '') return;
    if (withCwd && !cwd.trim().startsWith('/')) return;
    onSubmit(name.trim(), cwd.trim());
  };
  return (
    <form onSubmit={submit}>
      <input autoFocus placeholder={placeholder} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onCancel()} />
      {withCwd && <input placeholder="/absolute/path" value={cwd} onChange={(e) => setCwd(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onCancel()} />}
      <button className="mini" type="submit" title="save">ok</button>
    </form>
  );
};

const liveFor = (sessions: Record<string, SessionView>, sessionId: string): SessionView | undefined =>
  Object.values(sessions).find((s) => s.sessionId === sessionId && s.status !== 'history');

const SessionRow = ({ id, title, sessions, activeKey, onOpen }: { id: string; title: string; sessions: Record<string, SessionView>; activeKey: string | null; onOpen: () => void }) => {
  const live = liveFor(sessions, id);
  const viewing = Object.values(sessions).find((s) => s.sessionId === id);
  const active = viewing !== undefined && viewing.key === activeKey;
  const dotClass = live ? `dot ${live.status}` : 'dot';
  return (
    <div className={`row session selectable${active ? ' active' : ''}`} onClick={onOpen} title={id}>
      <span className={dotClass} />
      <span className="label">{title}</span>
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
  return (
    <aside className="rail">
      <h1>Workspaces</h1>
      {p.index?.workspaces.map((ws) => (
        <div className="workspace" key={ws.id}>
          <div className="row">
            <span className="label">{ws.name}</span>
            <button className="mini" title="new folder" onClick={() => setAdding(`folder:${ws.id}`)}>+ folder</button>
          </div>
          <div className="cwd" title={ws.cwd}>{short(ws.cwd)}</div>
          {adding === `folder:${ws.id}` && (
            <NameForm placeholder="folder name" onCancel={() => setAdding(null)} onSubmit={(name) => { p.onCreateFolder(ws.id, name); setAdding(null); }} />
          )}
          {ws.folders.map((folder) => (
            <div className="folder" key={folder.id}>
              <div className="row">
                <span className="label">{folder.name}</span>
                <button className="mini" title="new session" onClick={() => p.onNewSession(ws, folder)}>+ session</button>
              </div>
              {folder.sessions.map((s) => (
                <SessionRow key={s.sessionId} id={s.sessionId} title={titleOf(s.sessionId, ws)} sessions={p.sessions} activeKey={p.activeKey} onOpen={() => p.onOpenSession(ws, folder, s.sessionId, titleOf(s.sessionId, ws))} />
              ))}
              {folder.sessions.length === 0 && <div className="row session muted">empty</div>}
            </div>
          ))}
          {(p.unfiled[ws.id] ?? []).filter((s) => !filedIds.has(s.sessionId)).length > 0 && (
            <div className="folder">
              <div className="row"><span className="label muted">Unfiled</span></div>
              {(p.unfiled[ws.id] ?? []).filter((s) => !filedIds.has(s.sessionId)).map((s) => (
                <SessionRow key={s.sessionId} id={s.sessionId} title={s.customTitle || s.summary || s.firstPrompt || s.sessionId.slice(0, 8)} sessions={p.sessions} activeKey={p.activeKey} onOpen={() => p.onOpenSession(ws, null, s.sessionId, s.customTitle || s.summary || s.sessionId.slice(0, 8))} />
              ))}
            </div>
          )}
        </div>
      ))}
      {adding === 'workspace' ? (
        <NameForm placeholder="workspace name" withCwd onCancel={() => setAdding(null)} onSubmit={(name, cwd) => { p.onCreateWorkspace(name, cwd); setAdding(null); }} />
      ) : (
        <div className="row"><button className="mini" onClick={() => setAdding('workspace')}>+ workspace</button></div>
      )}
    </aside>
  );
};
