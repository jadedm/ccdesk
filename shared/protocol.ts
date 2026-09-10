// Wire protocol between the sidecar and the UI. Shared by both packages.

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';

export type PermissionSuggestion = Record<string, unknown>;

export type ClientMessage =
  | { type: 'start'; key: string; cwd: string; resume?: string; permissionMode?: PermissionMode; title?: string }
  | { type: 'prompt'; key: string; text: string }
  | { type: 'permission'; key: string; requestId: string; behavior: 'allow' | 'deny'; always?: boolean; message?: string }
  | { type: 'interrupt'; key: string }
  | { type: 'stop'; key: string };

export type PermissionRequest = {
  key: string;
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseID: string;
  title?: string;
  description?: string;
  suggestions?: PermissionSuggestion[];
};

export type ServerMessage =
  | { type: 'event'; key: string; message: unknown }
  | ({ type: 'permission_request' } & PermissionRequest)
  | { type: 'started'; key: string; sessionId: string }
  | { type: 'ended'; key: string; reason: string }
  | { type: 'error'; key: string; message: string };

export type IndexSession = { sessionId: string; cwd: string };
export type IndexFolder = { id: string; name: string; cwd?: string; sessions: IndexSession[] };
export type IndexWorkspace = { id: string; name: string; cwd: string; folders: IndexFolder[] };
export type WorkspaceIndex = { version: 1; workspaces: IndexWorkspace[] };

export type SessionSummary = {
  sessionId: string;
  summary: string;
  lastModified: number;
  customTitle?: string;
  firstPrompt?: string;
  cwd?: string;
  gitBranch?: string;
  createdAt?: number;
  /** From the sidecar's own scan of the transcript. */
  messages?: number;
  model?: string | null;
};

export type SidecarInfo = { port: number; token: string };

export type SearchHit = {
  sessionId: string;
  cwd: string;
  workspaceId: string;
  title: string;
  /** 1-based user turn the first hit is in; 1 when the hit is in the title or first prompt. */
  turn: number;
  snippet: string;
  lastModified: number;
};

export type SearchResponse = { results: SearchHit[]; scanned: number; truncated: boolean };
