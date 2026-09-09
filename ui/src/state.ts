import type { PermissionRequest, ServerMessage } from '../../shared/protocol.ts';
import { emptyTranscript, type Transcript } from './transcript/blocks.ts';
import { reduceAll, reduceRecord } from './transcript/reduce.ts';

export type SessionStatus = 'history' | 'starting' | 'idle' | 'running' | 'ended';

export type SessionView = {
  key: string;
  sessionId: string | null;
  cwd: string;
  folderId: string | null;
  title: string;
  status: SessionStatus;
  transcript: Transcript;
  permission: PermissionRequest | null;
  error: string | null;
};

export type State = {
  sessions: Record<string, SessionView>;
  activeKey: string | null;
};

export type Action =
  | { type: 'open_history'; key: string; sessionId: string; cwd: string; folderId: string | null; title: string; records: unknown[] }
  | { type: 'new_live'; key: string; cwd: string; folderId: string | null; title: string; resume: string | null; fromKey?: string }
  | { type: 'server'; message: ServerMessage }
  | { type: 'local_prompt'; key: string; text: string }
  | { type: 'set_status'; key: string; status: SessionStatus }
  | { type: 'activate'; key: string }
  | { type: 'rename'; key: string; title: string }
  | { type: 'permission_answered'; key: string }
  | { type: 'socket_reset' };

const messageType = (message: unknown): string => (message as { type?: string }).type ?? '';

// A session is 'running' only between a prompt and its result. Start-up events (init,
// started) leave it 'idle' so the composer offers Send rather than Interrupt.
const afterStartup = (status: SessionStatus): SessionStatus => (status === 'starting' ? 'idle' : status);

const applyServer = (session: SessionView, message: ServerMessage): SessionView => {
  if (message.type === 'started') return { ...session, sessionId: message.sessionId, status: afterStartup(session.status) };
  if (message.type === 'ended') return { ...session, status: 'ended', permission: null };
  if (message.type === 'error') return { ...session, error: message.message };
  if (message.type === 'permission_request') return { ...session, permission: message };
  const kind = messageType(message.message);
  const status: SessionStatus = kind === 'result' ? 'idle' : afterStartup(session.status);
  return { ...session, status, transcript: reduceRecord(session.transcript, message.message), permission: kind === 'result' ? null : session.permission };
};

// The sidecar stops every live session when its socket closes. After a reconnect, a session
// with a known id becomes a saved session again, so the next prompt resumes it; one that
// never reported an id has nothing to resume and is marked ended.
const afterSocketReset = (session: SessionView): SessionView => {
  if (session.status === 'history') return session;
  if (session.sessionId) return { ...session, status: 'history', permission: null };
  return { ...session, status: 'ended', permission: null, error: 'connection to the sidecar was lost before the session started' };
};

export const initialState: State = { sessions: {}, activeKey: null };

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'open_history': {
      const session: SessionView = {
        key: action.key,
        sessionId: action.sessionId,
        cwd: action.cwd,
        folderId: action.folderId,
        title: action.title,
        status: 'history',
        transcript: reduceAll(action.records),
        permission: null,
        error: null,
      };
      return { sessions: { ...state.sessions, [action.key]: session }, activeKey: action.key };
    }
    case 'new_live': {
      // Resuming a saved session carries its transcript over and retires the history view,
      // so the tree and the transcript keep pointing at one entry per session id.
      const existing = action.fromKey ? state.sessions[action.fromKey] : undefined;
      const sessions = { ...state.sessions };
      if (action.fromKey) delete sessions[action.fromKey];
      const session: SessionView = {
        key: action.key,
        sessionId: action.resume,
        cwd: action.cwd,
        folderId: action.folderId,
        title: action.title,
        status: 'starting',
        transcript: existing?.transcript ?? emptyTranscript(),
        permission: null,
        error: null,
      };
      return { sessions: { ...sessions, [action.key]: session }, activeKey: action.key };
    }
    case 'server': {
      const session = state.sessions[action.message.key];
      if (!session) return state;
      return { ...state, sessions: { ...state.sessions, [session.key]: applyServer(session, action.message) } };
    }
    case 'local_prompt': {
      const session = state.sessions[action.key];
      if (!session) return state;
      const record = { type: 'user', message: { role: 'user', content: action.text }, timestamp: new Date().toISOString() };
      const next = { ...session, status: 'running' as const, error: null, transcript: reduceRecord(session.transcript, record) };
      return { ...state, sessions: { ...state.sessions, [action.key]: next } };
    }
    case 'set_status': {
      const session = state.sessions[action.key];
      if (!session) return state;
      return { ...state, sessions: { ...state.sessions, [action.key]: { ...session, status: action.status } } };
    }
    case 'rename': {
      const session = state.sessions[action.key];
      if (!session) return state;
      return { ...state, sessions: { ...state.sessions, [action.key]: { ...session, title: action.title } } };
    }
    case 'activate':
      return { ...state, activeKey: action.key };
    case 'permission_answered': {
      const session = state.sessions[action.key];
      if (!session) return state;
      return { ...state, sessions: { ...state.sessions, [action.key]: { ...session, permission: null } } };
    }
    case 'socket_reset':
      return { ...state, sessions: Object.fromEntries(Object.entries(state.sessions).map(([k, v]) => [k, afterSocketReset(v)])) };
  }
};
