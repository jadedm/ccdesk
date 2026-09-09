import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { IndexFolder, IndexWorkspace, SessionSummary, WorkspaceIndex } from '../../shared/protocol.ts';
import { Api, Socket, discoverSidecar, type SocketState } from './api.ts';
import { Composer } from './components/Composer.tsx';
import { Transcript } from './components/Transcript.tsx';
import { Tree } from './components/Tree.tsx';
import { folderCwd, mergeListings, workspaceDirs, type ListedSession } from './cwd.ts';
import { clampRail, clampText, loadPrefs, savePrefs, type Prefs } from './prefs.ts';
import { initialState, reducer } from './state.ts';

let keyCounter = 0;
const newKey = (): string => `live-${Date.now()}-${++keyCounter}`;

const useSidecar = () => {
  const [api, setApi] = useState<Api | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    discoverSidecar()
      .then((info) => setApi(new Api(info)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  return { api, error };
};

export default function App() {
  const { api, error: discoveryError } = useSidecar();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [index, setIndex] = useState<WorkspaceIndex | null>(null);
  const [unfiled, setUnfiled] = useState<Record<string, ListedSession[]>>({});
  const [socketState, setSocketState] = useState<SocketState>('connecting');
  const everOpen = useRef(false);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const setPrefs = (change: Partial<Prefs>) => setPrefsState((current) => ({ ...current, ...change }));
  useEffect(() => savePrefs(prefs), [prefs]);
  const hideThinking = prefs.hideThinking;
  const [renaming, setRenaming] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const socket = useRef<Socket | null>(null);
  const pendingFile = useRef<Record<string, { folderId: string; cwd: string }>>({});
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refreshIndex = useCallback(async () => {
    if (!api) return;
    const idx = await api.index();
    setIndex(idx);
    // Unfiled covers the workspace directory and every folder directory, without repeats.
    const lists = await Promise.all(
      idx.workspaces.map(async (w) => {
        const dirs = workspaceDirs(w);
        const found = await Promise.all(dirs.map((d) => api.sessions(d).catch(() => [] as SessionSummary[])));
        return [w.id, mergeListings(dirs, found)] as const;
      }),
    );
    setUnfiled(Object.fromEntries(lists));
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const s = new Socket(
      api.socketUrl(),
      (message) => {
        dispatch({ type: 'server', message });
        const filing = message.type === 'started' ? pendingFile.current[message.key] : undefined;
        if (!filing || message.type !== 'started') return;
        delete pendingFile.current[message.key];
        void api.fileSession(filing.folderId, message.sessionId, filing.cwd).then(refreshIndex).catch((e: unknown) => setAppError(String(e)));
      },
      (st) => {
        setSocketState(st);
        if (st !== 'open') return;
        if (everOpen.current) dispatch({ type: 'socket_reset' });
        everOpen.current = true;
        void refreshIndex().catch((e: unknown) => setAppError(String(e)));
      },
    );
    socket.current = s;
    return () => s.close();
  }, [api, refreshIndex]);

  const active = state.activeKey ? state.sessions[state.activeKey] : null;

  const send = useCallback((m: Parameters<Socket['send']>[0]) => {
    if (socket.current?.send(m)) return;
    setAppError('sidecar is not connected; message not sent');
  }, []);

  // A saved session, or a live one that ended, resumes by id on the next prompt.
  const ensureLive = useCallback((key: string): string => {
    const session = stateRef.current.sessions[key];
    const resumable = session?.status === 'history' || session?.status === 'ended';
    if (!session || !resumable || !session.sessionId) return key;
    const liveKey = newKey();
    dispatch({ type: 'new_live', key: liveKey, cwd: session.cwd, folderId: session.folderId, title: session.title, resume: session.sessionId, fromKey: key });
    send({ type: 'start', key: liveKey, cwd: session.cwd, resume: session.sessionId });
    return liveKey;
  }, [send]);

  const onSend = (text: string) => {
    if (!active) return;
    const key = ensureLive(active.key);
    dispatch({ type: 'local_prompt', key, text });
    send({ type: 'prompt', key, text });
  };

  const onNewSession = (ws: IndexWorkspace, folder: IndexFolder, title: string) => {
    const key = newKey();
    const cwd = folderCwd(ws, folder);
    pendingFile.current[key] = { folderId: folder.id, cwd };
    dispatch({ type: 'new_live', key, cwd, folderId: folder.id, title: title || 'New session', resume: null });
    send({ type: 'start', key, cwd, title: title || undefined });
  };

  // Where a session's store lives: the filed cwd, the directory it was listed from, or the folder's.
  const onOpenSession = async (ws: IndexWorkspace, folder: IndexFolder | null, sessionId: string, title: string, listedIn?: string) => {
    if (!api) return;
    const cwd = folder?.sessions.find((s) => s.sessionId === sessionId)?.cwd ?? listedIn ?? folderCwd(ws, folder);
    const existing = Object.values(stateRef.current.sessions).find((s) => s.sessionId === sessionId);
    if (existing) {
      dispatch({ type: 'activate', key: existing.key });
      return;
    }
    const records = await api.messages(sessionId, cwd).catch((e: unknown) => {
      setAppError(String(e));
      return [] as unknown[];
    });
    dispatch({ type: 'open_history', key: `hist-${sessionId}`, sessionId, cwd, folderId: folder?.id ?? null, title, records });
  };

  const onRename = async (title: string) => {
    setRenaming(false);
    if (!api || !active?.sessionId || title.trim() === '' || title === active.title) return;
    const renamed = await api.rename(active.sessionId, active.cwd, title.trim()).then(() => true).catch((e: unknown) => {
      setAppError(String(e));
      return false;
    });
    if (!renamed) return;
    dispatch({ type: 'rename', key: active.key, title: title.trim() });
    void refreshIndex();
  };

  const statusText = useMemo(() => {
    if (!active) return '';
    if (active.error) return active.error;
    const labels: Record<string, string> = { history: 'saved session', starting: 'starting', idle: 'idle', running: 'working', ended: 'ended' };
    return labels[active.status] ?? active.status;
  }, [active]);

  const banner = discoveryError ?? (socketState !== 'open' ? `sidecar ${socketState}, retrying` : appError);

  // Pointer capture keeps the drag on the splitter until release, wherever the pointer
  // goes, and a release outside the window still ends it.
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (e.buttons === 0) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    setPrefs({ railWidth: clampRail(e.clientX) });
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const style = { '--rail': `${prefs.railWidth}px`, '--prose-size': `${prefs.textSize}px` } as React.CSSProperties;

  return (
    <div className="app" style={style}>
      <Tree
        index={index}
        unfiled={unfiled}
        sessions={state.sessions}
        activeKey={state.activeKey}
        onCreateWorkspace={(name, cwd) => api?.createWorkspace(name, cwd).then(refreshIndex).catch((e: unknown) => setAppError(String(e)))}
        onCreateFolder={(wid, name, cwd) => api?.createFolder(wid, name, cwd).then(refreshIndex).catch((e: unknown) => setAppError(String(e)))}
        onNewSession={onNewSession}
        onOpenSession={(ws, folder, id, title, listedIn) => void onOpenSession(ws, folder, id, title, listedIn)}
      />
      <div className="splitter" onPointerDown={startDrag} onPointerMove={drag} onPointerUp={endDrag} onPointerCancel={endDrag} title="drag to resize" />
      <main className="main">
        <div>
          {banner && (
            <div className={discoveryError || socketState !== 'open' ? 'banner' : 'banner info'} onClick={() => setAppError(null)}>
              {banner}
            </div>
          )}
          {active && (
            <div className="topbar">
              {renaming ? (
                <input className="rename" autoFocus defaultValue={active.title} onBlur={(e) => void onRename(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void onRename((e.target as HTMLInputElement).value); if (e.key === 'Escape') setRenaming(false); }} />
              ) : (
                <span className="title" onDoubleClick={() => active.sessionId && setRenaming(true)} title="double click to rename">{active.title}</span>
              )}
              <span>{active.cwd.replace(/^\/Users\/[^/]+/, '~')}</span>
              {active.transcript.model && <span>{active.transcript.model}</span>}
              <label><input type="checkbox" checked={!hideThinking} onChange={(e) => setPrefs({ hideThinking: !e.target.checked })} /> thinking</label>
              <label><input type="checkbox" checked={prefs.bionic} onChange={(e) => setPrefs({ bionic: e.target.checked })} /> bionic</label>
              <span className="sizer">
                <button className="mini" title="smaller text" onClick={() => setPrefs({ textSize: clampText(prefs.textSize - 1) })}>A-</button>
                <button className="mini" title="larger text" onClick={() => setPrefs({ textSize: clampText(prefs.textSize + 1) })}>A+</button>
              </span>
              <span className={`status ${active.error ? 'error' : active.status}`}>{statusText}</span>
            </div>
          )}
        </div>
        {active ? (
          <Transcript transcript={active.transcript} hideThinking={hideThinking} bionic={prefs.bionic} />
        ) : (
          <div className="transcript"><div className="empty">Pick a session on the left, or add a workspace.</div></div>
        )}
        {active && (
          <Composer
            status={active.status}
            permission={active.permission}
            onSend={onSend}
            onInterrupt={() => send({ type: 'interrupt', key: active.key })}
            onPermission={(requestId, behavior, always) => {
              send({ type: 'permission', key: active.key, requestId, behavior, always });
              dispatch({ type: 'permission_answered', key: active.key });
            }}
          />
        )}
      </main>
    </div>
  );
}
