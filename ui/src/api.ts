// Sidecar discovery and transport. Runs inside Tauri (asks the shell for port and token)
// or in a plain browser for smoke tests (reads ?port=&token= from the URL).

import type { ClientMessage, ServerMessage, SessionSummary, SidecarInfo, WorkspaceIndex } from '../../shared/protocol.ts';

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

const fromUrl = (): SidecarInfo | null => {
  const params = new URLSearchParams(window.location.search);
  const port = Number(params.get('port'));
  const token = params.get('token') ?? '';
  if (!port || token === '') return null;
  return { port, token };
};

export const discoverSidecar = async (): Promise<SidecarInfo> => {
  const fromQuery = fromUrl();
  if (fromQuery) return fromQuery;
  if (!(window as TauriWindow).__TAURI_INTERNALS__) throw new Error('no sidecar: open with ?port=&token= or inside ccdesk');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<SidecarInfo>('sidecar_info');
};

export class Api {
  private readonly info: SidecarInfo;

  constructor(info: SidecarInfo) {
    this.info = info;
  }

  private get base(): string {
    return `http://127.0.0.1:${this.info.port}`;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: { authorization: `Bearer ${this.info.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: unknown = await res.json();
    if (!res.ok) {
      const err = json as { error?: string; message?: string };
      throw new Error(err.message ?? err.error ?? `${method} ${path} failed with ${res.status}`);
    }
    return json as T;
  }

  health = () => this.call<{ ok: boolean; sdkVersion: string }>('GET', '/health');
  index = () => this.call<WorkspaceIndex>('GET', '/index');
  createWorkspace = (name: string, cwd: string) => this.call<{ id: string }>('POST', '/workspaces', { name, cwd });
  createFolder = (workspaceId: string, name: string) => this.call<{ id: string }>('POST', `/workspaces/${workspaceId}/folders`, { name });
  fileSession = (folderId: string, sessionId: string, cwd: string) =>
    this.call<unknown>('POST', `/folders/${folderId}/sessions`, { sessionId, cwd });
  sessions = (cwd: string) => this.call<SessionSummary[]>('GET', `/sessions?cwd=${encodeURIComponent(cwd)}`);
  messages = (sessionId: string, cwd: string) =>
    this.call<unknown[]>('GET', `/sessions/${sessionId}/messages?cwd=${encodeURIComponent(cwd)}`);
  rename = (sessionId: string, cwd: string, title: string) => this.call<unknown>('PATCH', `/sessions/${sessionId}`, { cwd, title });

  socketUrl(): string {
    return `ws://127.0.0.1:${this.info.port}/ws?token=${this.info.token}`;
  }
}

export type SocketState = 'connecting' | 'open' | 'closed';

/** WebSocket with reconnect. Messages sent while closed are dropped and reported. */
export class Socket {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private closedByUser = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  state: SocketState = 'connecting';
  private readonly url: string;
  private readonly onMessage: (m: ServerMessage) => void;
  private readonly onState: (s: SocketState) => void;

  constructor(url: string, onMessage: (m: ServerMessage) => void, onState: (s: SocketState) => void) {
    this.url = url;
    this.onMessage = onMessage;
    this.onState = onState;
    this.connect();
  }

  private connect(): void {
    this.setState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.setState('open');
    };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
    ws.onclose = () => {
      this.setState('closed');
      if (this.closedByUser) return;
      const delay = Math.min(10_000, 500 * 2 ** this.attempts++);
      this.retry = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private setState(s: SocketState): void {
    this.state = s;
    this.onState(s);
  }

  send(message: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.closedByUser = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
  }
}
