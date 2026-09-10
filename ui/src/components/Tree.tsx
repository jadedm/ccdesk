import { useRef, useState } from 'react';
import type { IndexFolder, IndexWorkspace, WorkspaceIndex } from '../../../shared/protocol.ts';
import type { ListedSession } from '../cwd.ts';
import { metaLine, type RowMeta } from '../meta.ts';
import { AddForm } from './AddForm.tsx';
import { RowMenu, type MenuAction, type RowMenuHandle } from './RowMenu.tsx';
import type { DirectoryReport } from '../../../shared/protocol.ts';
import { hasNativeDialog, pickDirectory } from '../pick.ts';
import type { SessionView } from '../state.ts';

export type Organise = {
  renameWorkspace: (id: string, name: string) => void;
  setWorkspaceCwd: (id: string, cwd: string) => void;
  setFolderCwd: (id: string, cwd: string) => void;
  deleteWorkspace: (id: string) => void;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  renameSession: (sessionId: string, cwd: string, title: string) => void;
  moveSession: (folderId: string, sessionId: string, targetFolderId: string) => void;
  unfileSession: (folderId: string, sessionId: string) => void;
  fileSession: (folderId: string, sessionId: string, cwd: string) => void;
};

export type TreeProps = {
  onCollapse: () => void;
  organise: Organise;
  search: React.ReactNode;
  describeDirectory: (path: string) => Promise<DirectoryReport>;
  index: WorkspaceIndex | null;
  unfiled: Record<string, ListedSession[]>;
  sessions: Record<string, SessionView>;
  activeKey: string | null;
  onCreateWorkspace: (name: string, cwd: string) => Promise<void>;
  onCreateFolder: (workspaceId: string, name: string, cwd: string | null) => Promise<void>;
  onNewSession: (workspace: IndexWorkspace, folder: IndexFolder, title: string) => void;
  onOpenSession: (workspace: IndexWorkspace, folder: IndexFolder | null, sessionId: string, title: string, listedIn?: string) => void;
};

const short = (path: string): string => path.replace(/^\/Users\/[^/]+/, '~');

const liveFor = (sessions: Record<string, SessionView>, sessionId: string): SessionView | undefined =>
  Object.values(sessions).find((s) => s.sessionId === sessionId && s.status !== 'history');

/** An inline text field that commits on Enter or blur and cancels on Escape. */
const InlineName = ({ value, onCommit, onCancel }: { value: string; onCommit: (name: string) => void; onCancel: () => void }) => {
  const [text, setText] = useState(value);
  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === '' || trimmed === value) onCancel();
    else onCommit(trimmed);
  };
  return (
    <input
      className="inline-name"
      autoFocus
      value={text}
      aria-label="new name"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
    />
  );
};

const SessionRow = ({ id, title, meta, sessions, activeKey, onOpen, actions, renaming, onRename, onCancelRename }: { id: string; title: string; meta: RowMeta; sessions: Record<string, SessionView>; activeKey: string | null; onOpen: () => void; actions: MenuAction[]; renaming: boolean; onRename: (name: string) => void; onCancelRename: () => void }) => {
  const menuRef = useRef<RowMenuHandle>(null);
  const onContextMenu = (e: React.MouseEvent) => {
    // While renaming, the field's own menu is the useful one: it carries paste.
    if (renaming) return;
    e.preventDefault();
    menuRef.current?.openAt(e.clientX, e.clientY);
  };
  const live = liveFor(sessions, id);
  const viewing = Object.values(sessions).find((s) => s.sessionId === id);
  const active = viewing !== undefined && viewing.key === activeKey;
  const dotClass = live ? `dot ${live.status}` : 'dot';
  const line = live ? (live.status === 'running' ? 'working' : live.status) : metaLine(meta);
  return (
    <div className={`row session${active ? ' active' : ''}`} onContextMenu={onContextMenu} title={title}>
      <span className={dotClass} />
      {renaming ? (
        <span className="label"><InlineName value={title} onCommit={onRename} onCancel={onCancelRename} /></span>
      ) : (
        <button type="button" className="label rowopen" onClick={onOpen} aria-current={active ? 'true' : undefined}>
          <span className="st">{title}</span>
          {line && <span className="sm">{line}</span>}
        </button>
      )}
      <RowMenu label={`actions for ${title}`} actions={actions} ref={menuRef} />
    </div>
  );
};

/** Deleting only forgets the grouping; the CLI keeps every transcript. A folder that carries
 * its own directory also carries the only reference to it, so its sessions stop being listed
 * until another folder points there again. The text says which case this is. */
const confirmDelete = (kind: string, name: string, ownDirectory?: string): boolean => {
  const fate = ownDirectory
    ? `Its sessions stay on disk in ${ownDirectory}, but they will not be listed until a folder points there again.`
    : 'Its sessions stay on disk and reappear under Unfiled.';
  return window.confirm(`Delete the ${kind} "${name}"? ${fate} Only the grouping is forgotten.`);
};

export const Tree = (p: TreeProps) => {
  const [adding, setAdding] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const formHasText = useRef(false);
  const workspaceMenus = useRef<Record<string, RowMenuHandle | null>>({});
  const folderMenus = useRef<Record<string, RowMenuHandle | null>>({});

  const formTrigger = useRef<HTMLButtonElement | null>(null);

  /** Any exit from a form that holds typing asks first, whether that is another trigger, the
   * same trigger again, or hiding the rail. */
  const mayDiscard = (): boolean => !formHasText.current || window.confirm('Discard what you typed in the form?');

  const openForm = (key: string, trigger: HTMLButtonElement | null) => {
    if (adding && !mayDiscard()) return;
    formHasText.current = false;
    formTrigger.current = adding === key ? null : trigger;
    setAdding(adding === key ? null : key);
  };

  /** Cancelling returns focus to whatever opened the form, so the keyboard does not restart. */
  const closeForm = () => {
    formHasText.current = false;
    setAdding(null);
    const trigger = formTrigger.current;
    formTrigger.current = null;
    window.setTimeout(() => trigger?.focus(), 0);
  };

  const collapse = () => {
    if (adding && !mayDiscard()) return;
    formHasText.current = false;
    setAdding(null);
    p.onCollapse();
  };
  const noteContent = (has: boolean) => { formHasText.current = has; };
  const filedIds = new Set(p.index?.workspaces.flatMap((w) => w.folders.flatMap((f) => f.sessions.map((s) => s.sessionId))) ?? []);
  const titleOf = (id: string, ws: IndexWorkspace): string => {
    const known = p.unfiled[ws.id]?.find((s) => s.sessionId === id);
    const live = Object.values(p.sessions).find((s) => s.sessionId === id);
    return live?.title || known?.customTitle || known?.summary || known?.firstPrompt || id.slice(0, 8);
  };
  const metaOf = (id: string, ws: IndexWorkspace): RowMeta => p.unfiled[ws.id]?.find((s) => s.sessionId === id) ?? {};
  const unfiledOf = (ws: IndexWorkspace): ListedSession[] => (p.unfiled[ws.id] ?? []).filter((s) => !filedIds.has(s.sessionId));
  const empty = (p.index?.workspaces.length ?? 0) === 0;

  /** Picks a directory natively when possible, and falls back to a prompt in the browser. */
  const changeDirectory = async (current: string, apply: (cwd: string) => void) => {
    const chosen = hasNativeDialog() ? await pickDirectory(current) : window.prompt('Full path to the directory', current);
    const trimmed = chosen?.trim();
    if (!trimmed || !trimmed.startsWith('/')) return;
    apply(trimmed);
  };

  const sessionActions = (ws: IndexWorkspace, folder: IndexFolder | null, sessionId: string, cwd: string): MenuAction[] => {
    const others = ws.folders.filter((f) => f.id !== folder?.id);
    const move = folder ? others.map((f) => ({ label: `Move to ${f.name}`, onPick: () => p.organise.moveSession(folder.id, sessionId, f.id) })) : others.map((f) => ({ label: `File into ${f.name}`, onPick: () => p.organise.fileSession(f.id, sessionId, cwd) }));
    const unfile = folder ? [{ label: 'Unfile', onPick: () => p.organise.unfileSession(folder.id, sessionId) }] : [];
    return [{ label: 'Rename', onPick: () => setRenaming(sessionId) }, ...move, ...unfile];
  };

  return (
    <aside className="rail">
      <div className="rail-head">
        <h1>Workspaces</h1>
        <span className="rail-head-actions">
          <button className="mini" onClick={(e) => openForm('workspace', e.currentTarget)}>+ workspace</button>
          <button className="mini" title="Cmd+B" onClick={collapse}>Hide sidebar</button>
        </span>
      </div>
      {adding === 'workspace' && (
        <AddForm kind="workspace" describe={p.describeDirectory} onCancel={closeForm} onContentChange={noteContent} onSubmit={({ name, cwd }) => p.onCreateWorkspace(name, cwd).then(closeForm)} />
      )}
      {!empty && p.search}
      {p.index?.workspaces.map((ws) => {
        const unfiled = unfiledOf(ws);
        return (
        <div className="workspace" key={ws.id}>
          <div className="row" onContextMenu={(e) => { e.preventDefault(); workspaceMenus.current[ws.id]?.openAt(e.clientX, e.clientY); }}>
            {renaming === ws.id ? (
              <InlineName value={ws.name} onCommit={(name) => { p.organise.renameWorkspace(ws.id, name); setRenaming(null); }} onCancel={() => setRenaming(null)} />
            ) : (
              <span className="label">{ws.name}</span>
            )}
            <button className="mini" title="new folder" onClick={(e) => openForm(`folder:${ws.id}`, e.currentTarget)}>+ folder</button>
            <RowMenu ref={(h) => { workspaceMenus.current[ws.id] = h; }} label={`actions for ${ws.name}`} actions={[
              { label: 'Rename', onPick: () => setRenaming(ws.id) },
              { label: 'Change directory…', onPick: () => void changeDirectory(ws.cwd, (cwd) => p.organise.setWorkspaceCwd(ws.id, cwd)) },
              { label: 'Delete workspace', danger: true, onPick: () => confirmDelete('workspace', ws.name) && p.organise.deleteWorkspace(ws.id) },
            ]} />
          </div>
          <div className="cwd" title={ws.cwd}>{short(ws.cwd)}</div>
          {adding === `folder:${ws.id}` && (
            <AddForm kind="folder" defaultDirectory={ws.cwd} describe={p.describeDirectory} onCancel={closeForm} onContentChange={noteContent} onSubmit={({ name, cwd }) => p.onCreateFolder(ws.id, name, cwd || null).then(closeForm)} />
          )}
          {ws.folders.map((folder) => (
            <div className="folder" key={folder.id}>
              <div className="row" onContextMenu={(e) => { e.preventDefault(); folderMenus.current[folder.id]?.openAt(e.clientX, e.clientY); }}>
                {renaming === folder.id ? (
                  <InlineName value={folder.name} onCommit={(name) => { p.organise.renameFolder(folder.id, name); setRenaming(null); }} onCancel={() => setRenaming(null)} />
                ) : (
                  <span className="label">{folder.name}</span>
                )}
                <button className="mini" title="new session" onClick={(e) => openForm(`session:${folder.id}`, e.currentTarget)}>+ session</button>
                <RowMenu ref={(h) => { folderMenus.current[folder.id] = h; }} label={`actions for ${folder.name}`} actions={[
                  { label: 'Rename', onPick: () => setRenaming(folder.id) },
                  { label: 'Change directory…', onPick: () => void changeDirectory(folder.cwd ?? ws.cwd, (cwd) => p.organise.setFolderCwd(folder.id, cwd)) },
                  { label: 'Delete folder', danger: true, onPick: () => confirmDelete('folder', folder.name, folder.cwd) && p.organise.deleteFolder(folder.id) },
                ]} />
              </div>
              {folder.cwd && <div className="cwd" title={folder.cwd}>{short(folder.cwd)}</div>}
              {adding === `session:${folder.id}` && (
                <AddForm kind="session" onCancel={closeForm} onContentChange={noteContent} onSubmit={({ name }) => { p.onNewSession(ws, folder, name); closeForm(); }} />
              )}
              {folder.sessions.map((s) => (
                <SessionRow
                  key={s.sessionId}
                  id={s.sessionId}
                  title={titleOf(s.sessionId, ws)}
                  meta={metaOf(s.sessionId, ws)}
                  sessions={p.sessions}
                  activeKey={p.activeKey}
                  onOpen={() => p.onOpenSession(ws, folder, s.sessionId, titleOf(s.sessionId, ws))}
                  actions={sessionActions(ws, folder, s.sessionId, s.cwd)}
                  renaming={renaming === s.sessionId}
                  onRename={(name) => { p.organise.renameSession(s.sessionId, s.cwd, name); setRenaming(null); }}
                  onCancelRename={() => setRenaming(null)}
                />
              ))}
              {folder.sessions.length === 0 && adding !== `session:${folder.id}` && <div className="row session muted">empty</div>}
            </div>
          ))}
          {unfiled.length > 0 && (
            <div className="folder">
              <div className="row"><span className="label muted">Unfiled</span></div>
              {unfiled.map((s) => (
                <SessionRow
                  key={s.sessionId}
                  id={s.sessionId}
                  title={s.customTitle || s.summary || s.firstPrompt || s.sessionId.slice(0, 8)}
                  meta={s}
                  sessions={p.sessions}
                  activeKey={p.activeKey}
                  onOpen={() => p.onOpenSession(ws, null, s.sessionId, s.customTitle || s.summary || s.sessionId.slice(0, 8), s.listedIn)}
                  actions={sessionActions(ws, null, s.sessionId, s.listedIn)}
                  renaming={renaming === s.sessionId}
                  onRename={(name) => { p.organise.renameSession(s.sessionId, s.listedIn, name); setRenaming(null); }}
                  onCancelRename={() => setRenaming(null)}
                />
              ))}
            </div>
          )}
        </div>
        );
      })}
      {empty && (
        <div className="rail-empty">
          <p>No workspaces yet.</p>
          <p className="muted">A workspace is a directory on disk. Add the project you run Claude Code in and its sessions appear here.</p>
        </div>
      )}
    </aside>
  );
};
