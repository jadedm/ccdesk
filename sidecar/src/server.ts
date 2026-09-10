import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { getSessionMessages, listSessions, renameSession } from '@anthropic-ai/claude-agent-sdk';
import type { ClientMessage, PermissionMode, ServerMessage, SidecarInfo } from '../../shared/protocol.ts';
import { HttpError, badRequest, notFound } from './errors.ts';
import { IndexStore } from './index-store.ts';
import { SessionManager } from './sessions.ts';
import { SessionMetaCache, sessionFile } from './session-meta.ts';
import { MAX_RESULTS, matchSummary, searchFile, sortHits } from './search.ts';
import type { SearchHit, SearchResponse } from '../../shared/protocol.ts';

export type ServerConfig = { indexPath: string; sdkVersion: string; claudeBinary?: string; port?: number; token?: string };

type Params = Record<string, string>;

const permissionModes: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'];
type Handler = (req: IncomingMessage, params: Params, body: Record<string, unknown>, url: URL) => Promise<unknown>;
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

const route = (method: string, path: string, handler: Handler): Route => {
  const keys: string[] = [];
  const source = path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${source}$`), keys, handler };
};

const maxBodyBytes = 1_000_000;

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBodyBytes) throw badRequest('body_too_large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw badRequest('body_must_be_object');
  return parsed as Record<string, unknown>;
};

const requireCwd = (value: string | null): string => {
  if (!value || !value.startsWith('/')) throw badRequest('cwd_required', 'absolute cwd query parameter required');
  return value;
};

// The UI runs on another origin: the Vite dev server in a browser, or the Tauri webview
// (tauri://localhost on macOS). The bearer token is the access control, so any origin may
// call; a page that does not hold the token gets 401 like everyone else.
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-max-age': '600',
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...corsHeaders });
  res.end(JSON.stringify(body));
};

const errorBody = (error: unknown): { status: number; body: { error: string; message: string } } => {
  if (error instanceof HttpError) return { status: error.status, body: { error: error.code, message: error.message } };
  if (error instanceof SyntaxError) return { status: 400, body: { error: 'invalid_json', message: error.message } };
  if (error instanceof URIError) return { status: 400, body: { error: 'bad_path', message: error.message } };
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, body: { error: 'internal', message } };
};

export type RunningServer = SidecarInfo & { close: () => Promise<void> };

export const startServer = async (config: ServerConfig): Promise<RunningServer> => {
  const token = config.token ?? randomBytes(24).toString('hex');
  const meta = new SessionMetaCache();
  const store = new IndexStore(config.indexPath);
  const warning = await store.load();
  if (warning) process.stderr.write(`${warning}\n`);

  const routes: Route[] = [
    route('GET', '/health', async () => ({ ok: true, sdkVersion: config.sdkVersion })),
    route('GET', '/index', async () => store.snapshot()),
    route('POST', '/workspaces', async (_req, _p, body) => store.createWorkspace(body.name, body.cwd)),
    route('POST', '/workspaces/:wid/folders', async (_req, p, body) => store.createFolder(p.wid, body.name, body.cwd)),
    route('POST', '/folders/:fid/sessions', async (_req, p, body) => store.fileSession(p.fid, body.sessionId, body.cwd)),
    route('PATCH', '/workspaces/:wid', async (_req, p, body) => store.renameWorkspace(p.wid, body.name)),
    route('DELETE', '/workspaces/:wid', async (_req, p) => {
      await store.deleteWorkspace(p.wid);
      return { ok: true };
    }),
    route('PATCH', '/folders/:fid', async (_req, p, body) => store.renameFolder(p.fid, body.name)),
    route('DELETE', '/folders/:fid', async (_req, p) => {
      await store.deleteFolder(p.fid);
      return { ok: true };
    }),
    route('PATCH', '/folders/:fid/sessions/:id', async (_req, p, body) => store.moveSession(p.fid, p.id, body.folderId)),
    route('DELETE', '/folders/:fid/sessions/:id', async (_req, p) => {
      await store.unfileSession(p.fid, p.id);
      return { ok: true };
    }),
    route('GET', '/search', async (_req, _p, _b, url) => search((url.searchParams.get('q') ?? '').trim())),
    route('GET', '/sessions', async (_req, _p, _b, url) => {
      const cwd = requireCwd(url.searchParams.get('cwd'));
      const list = await listSessions({ dir: cwd });
      // A session listed for this directory may live in another worktree's store; its own
      // cwd names that store.
      return Promise.all(list.map(async (s) => ({ ...s, ...(await meta.read(sessionFile(s.cwd ?? cwd, s.sessionId))) })));
    }),
    route('GET', '/sessions/:id/messages', async (_req, p, _b, url) =>
      getSessionMessages(p.id, { dir: requireCwd(url.searchParams.get('cwd')) }),
    ),
    route('PATCH', '/sessions/:id', async (_req, p, body) => {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (title === '') throw badRequest('title_required');
      const cwd = typeof body.cwd === 'string' ? body.cwd : '';
      await renameSession(p.id, title, { dir: requireCwd(cwd) });
      return { ok: true };
    }),
  ];

  // HTTP routes take the token as a bearer header only. The WebSocket upgrade is the one
  // place a browser cannot set a header, so that route alone accepts it as a query parameter.
  // Every directory the index knows about, each scanned once even when shared by folders.
  const search = async (q: string): Promise<SearchResponse> => {
    if (q.length < 2) throw badRequest('query_too_short', 'at least two characters');
    const dirs = new Map<string, string>();
    for (const w of store.snapshot().workspaces) {
      dirs.set(w.cwd, w.id);
      for (const f of w.folders) {
        if (f.cwd && !dirs.has(f.cwd)) dirs.set(f.cwd, w.id);
        // A filed session keeps the directory it was filed from, which may be neither.
        for (const s of f.sessions) if (!dirs.has(s.cwd)) dirs.set(s.cwd, w.id);
      }
    }
    const hits: SearchHit[] = [];
    let scanned = 0;
    const seen = new Set<string>();
    for (const [dir, workspaceId] of dirs) {
      const list = await listSessions({ dir }).catch(() => []);
      for (const s of list) {
        if (seen.has(s.sessionId)) continue;
        seen.add(s.sessionId);
        scanned++;
        const title = s.customTitle || s.summary || s.firstPrompt || s.sessionId.slice(0, 8);
        const hit = matchSummary(s, q) ?? (await searchFile(sessionFile(s.cwd ?? dir, s.sessionId), q).catch(() => null));
        if (!hit) continue;
        hits.push({ sessionId: s.sessionId, cwd: s.cwd ?? dir, workspaceId, title, turn: hit.turn, snippet: hit.snippet, lastModified: s.lastModified });
      }
    }
    const sorted = sortHits(hits);
    return { results: sorted.slice(0, MAX_RESULTS), scanned, truncated: sorted.length > MAX_RESULTS };
  };

  const authorized = (req: IncomingMessage): boolean => (req.headers.authorization ?? '') === `Bearer ${token}`;
  const upgradeAuthorized = (url: URL): boolean => url.searchParams.get('token') === token;

  const dispatch = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }
    if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' });
    const match = routes
      .map((r) => ({ r, m: req.method === r.method ? url.pathname.match(r.pattern) : null }))
      .find((x) => x.m !== null);
    if (!match || !match.m) throw notFound('route_not_found', `${req.method} ${url.pathname}`);
    const params: Params = Object.fromEntries(match.r.keys.map((k, i) => [k, decodeURIComponent(match.m![i + 1])]));
    const body = req.method === 'GET' ? {} : await readBody(req);
    sendJson(res, 200, await match.r.handler(req, params, body, url));
  };

  const http: Server = createServer((req, res) => {
    dispatch(req, res).catch((error: unknown) => {
      const { status, body } = errorBody(error);
      sendJson(res, status, body);
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  const managers = new Set<SessionManager>();

  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws' || !upgradeAuthorized(url)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attach(ws));
  });

  const attach = (ws: WebSocket): void => {
    const send = (message: ServerMessage): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };
    const manager = new SessionManager(send, config.claudeBinary);
    managers.add(manager);
    ws.on('message', (raw) => handle(manager, send, raw.toString()));
    ws.on('close', () => {
      managers.delete(manager);
      manager.stopAll();
    });
  };

  const parseFrame = (raw: string): ClientMessage | null => {
    try {
      const parsed: unknown = JSON.parse(raw);
      const shaped = typeof parsed === 'object' && parsed !== null && typeof (parsed as { type?: unknown }).type === 'string';
      return shaped && typeof (parsed as { key?: unknown }).key === 'string' ? (parsed as ClientMessage) : null;
    } catch {
      return null;
    }
  };

  const handle = (manager: SessionManager, send: (m: ServerMessage) => void, raw: string): void => {
    const message = parseFrame(raw);
    if (!message) {
      send({ type: 'error', key: '', message: 'malformed frame: expected an object with string type and key' });
      return;
    }
    const actions: Record<ClientMessage['type'], () => void> = {
      start: () => {
        const m = message as Extract<ClientMessage, { type: 'start' }>;
        if (typeof m.cwd !== 'string' || !m.cwd.startsWith('/')) throw badRequest('cwd_required', 'absolute cwd required');
        if (m.permissionMode !== undefined && !permissionModes.includes(m.permissionMode)) throw badRequest('bad_permission_mode');
        if (m.resume !== undefined && (typeof m.resume !== 'string' || m.resume === '')) throw badRequest('bad_resume');
        const title = typeof m.title === 'string' && m.title.trim() !== '' ? m.title.trim() : undefined;
        manager.start(m.key, { cwd: m.cwd, resume: m.resume, permissionMode: m.permissionMode, title });
      },
      prompt: () => {
        const m = message as Extract<ClientMessage, { type: 'prompt' }>;
        manager.prompt(m.key, m.text);
      },
      permission: () => {
        const m = message as Extract<ClientMessage, { type: 'permission' }>;
        manager.permission(m.key, m.requestId, m.behavior, m.always ?? false, m.message);
      },
      interrupt: () => void manager.interrupt(message.key),
      stop: () => manager.stop(message.key),
    };
    const action = actions[message.type];
    if (!action) {
      send({ type: 'error', key: message.key, message: `unknown message type ${message.type}` });
      return;
    }
    // A throw here is one client's bad frame or one session's failure to start, never a
    // reason to drop every other session on the socket.
    try {
      action();
    } catch (error) {
      send({ type: 'error', key: message.key, message: error instanceof Error ? error.message : String(error) });
    }
  };

  await new Promise<void>((resolve) => http.listen(config.port ?? 0, '127.0.0.1', resolve));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  // Shutdown must finish even with keep-alive connections open and CLI children still
  // winding down, so idle sockets are cut and the wait has a deadline.
  const close = async (): Promise<void> => {
    for (const manager of managers) manager.stopAll();
    for (const client of wss.clients) client.terminate();
    http.closeAllConnections();
    await Promise.race([
      new Promise<void>((resolve) => http.close(() => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000).unref()),
    ]);
  };

  return { port, token, close };
};
