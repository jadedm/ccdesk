import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { IndexFolder, IndexWorkspace, SessionSummary, WorkspaceIndex } from '../../shared/protocol.ts';
import { Api, Socket, discoverSidecar, type SocketState } from './api.ts';
import { Composer } from './components/Composer.tsx';
import { Transcript } from './components/Transcript.tsx';
import { Tree } from './components/Tree.tsx';
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
  const [unfiled, setUnfiled] = useState<Record<string, SessionSummary[]>>({});
  const [socketState, setSocketState] = useState<SocketState>('connecting');
  const everOpen = useRef(false);
  const [hideThinking, setHideThinking] = useState(true);
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
    const lists = await Promise.all(idx.workspaces.map(async (w) => [w.id, await api.sessions(w.cwd).catch(() => [])] as const));
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

  const onNewSession = (ws: IndexWorkspace, folder: IndexFolder) => {
    const key = newKey();
    pendingFile.current[key] = { folderId: folder.id, cwd: ws.cwd };
    dispatch({ type: 'new_live', key, cwd: ws.cwd, folderId: folder.id, title: 'New session', resume: null });
    send({ type: 'start', key, cwd: ws.cwd });
  };

  const onOpenSession = async (ws: IndexWorkspace, folder: IndexFolder | null, sessionId: string, title: string) => {
    if (!api) return;
    const cwd = folder?.sessions.find((s) => s.sessionId === sessionId)?.cwd ?? ws.cwd;
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

  return (
    <div className="app">
      <Tree
        index={index}
        unfiled={unfiled}
        sessions={state.sessions}
        activeKey={state.activeKey}
        onCreateWorkspace={(name, cwd) => api?.createWorkspace(name, cwd).then(refreshIndex).catch((e: unknown) => setAppError(String(e)))}
        onCreateFolder={(wid, name) => api?.createFolder(wid, name).then(refreshIndex).catch((e: unknown) => setAppError(String(e)))}
        onNewSession={onNewSession}
        onOpenSession={(ws, folder, id, title) => void onOpenSession(ws, folder, id, title)}
      />
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
              <label><input type="checkbox" checked={!hideThinking} onChange={(e) => setHideThinking(!e.target.checked)} /> thinking</label>
              <span className={`status ${active.error ? 'error' : active.status}`}>{statusText}</span>
            </div>
          )}
        </div>
        {active ? (
          <Transcript transcript={active.transcript} hideThinking={hideThinking} />
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
