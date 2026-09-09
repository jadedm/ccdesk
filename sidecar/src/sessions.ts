import {
  query,
  type CanUseTool,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { PermissionMode, ServerMessage } from '../../shared/protocol.ts';

export type Emit = (message: ServerMessage) => void;

type StartOptions = { cwd: string; resume?: string; permissionMode?: PermissionMode; title?: string };

/** A push queue exposed as the async iterable the SDK reads prompts from. */
class PromptQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = [];
  private waiter: ((value: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(text: string): void {
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    };
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: message, done: false });
      return;
    }
    this.items.push(message);
  }

  close(): void {
    this.closed = true;
    if (!this.waiter) return;
    const resolve = this.waiter;
    this.waiter = null;
    resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
    };
  }
}

type PendingPermission = { resolve: (result: PermissionResult) => void; suggestions?: PermissionUpdate[] };

class LiveSession {
  readonly prompts = new PromptQueue();
  readonly pending = new Map<string, PendingPermission>();
  readonly abort = new AbortController();
  sessionId: string | null = null;
  query: Query | null = null;

  constructor(
    readonly key: string,
    private readonly emit: Emit,
  ) {}

  start(options: StartOptions, claudeBinary?: string): void {
    const sdkOptions: Options = {
      cwd: options.cwd,
      resume: options.resume,
      title: options.title,
      permissionMode: options.permissionMode ?? 'default',
      includePartialMessages: true,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      canUseTool: this.canUseTool,
      abortController: this.abort,
      pathToClaudeCodeExecutable: claudeBinary,
      stderr: (line) => process.stderr.write(`[sdk ${this.key}] ${line}`),
    };
    // query() can throw synchronously, for example when the CLI binary is missing. That is
    // a session failure to report, not a reason for the sidecar process to die.
    try {
      this.query = query({ prompt: this.prompts, options: sdkOptions });
    } catch (error) {
      this.emit({ type: 'error', key: this.key, message: error instanceof Error ? error.message : String(error) });
      this.emit({ type: 'ended', key: this.key, reason: 'error' });
      return;
    }
    void this.pump(this.query);
  }

  private readonly canUseTool: CanUseTool = (toolName, input, options) => {
    const { requestId, toolUseID, title, description, suggestions } = options;
    return new Promise<PermissionResult>((resolve) => {
      this.pending.set(requestId, { resolve, suggestions });
      this.emit({ type: 'permission_request', key: this.key, requestId, toolName, input, toolUseID, title, description, suggestions: suggestions as Record<string, unknown>[] | undefined });
      options.signal.addEventListener('abort', () => {
        if (!this.pending.delete(requestId)) return;
        resolve({ behavior: 'deny', message: 'aborted' });
      });
    });
  };

  answerPermission(requestId: string, behavior: 'allow' | 'deny', always: boolean, message?: string): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.pending.delete(requestId);
    const result: PermissionResult =
      behavior === 'allow'
        ? { behavior, updatedPermissions: always ? pending.suggestions : undefined }
        : { behavior, message: message ?? 'denied by user' };
    pending.resolve(result);
    return true;
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const message of q) this.forward(message);
      this.emit({ type: 'ended', key: this.key, reason: 'finished' });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'error', key: this.key, message: text });
      this.emit({ type: 'ended', key: this.key, reason: 'error' });
    }
  }

  private forward(message: SDKMessage): void {
    if (message.type === 'system' && message.subtype === 'init' && this.sessionId === null) {
      this.sessionId = message.session_id;
      this.emit({ type: 'started', key: this.key, sessionId: message.session_id });
    }
    this.emit({ type: 'event', key: this.key, message });
  }

  stop(): void {
    this.prompts.close();
    this.abort.abort();
    for (const pending of this.pending.values()) pending.resolve({ behavior: 'deny', message: 'session stopped' });
    this.pending.clear();
  }
}

/** All live sessions for one connected client. */
export class SessionManager {
  private readonly sessions = new Map<string, LiveSession>();

  constructor(
    private readonly emit: Emit,
    private readonly claudeBinary?: string,
  ) {}

  start(key: string, options: StartOptions): void {
    if (this.sessions.has(key)) {
      this.emit({ type: 'error', key, message: 'session key already live' });
      return;
    }
    const session = new LiveSession(key, (message) => {
      if (message.type === 'ended') this.sessions.delete(key);
      this.emit(message);
    });
    this.sessions.set(key, session);
    session.start(options, this.claudeBinary);
  }

  prompt(key: string, text: string): void {
    const session = this.require(key);
    if (!session) return;
    session.prompts.push(text);
  }

  permission(key: string, requestId: string, behavior: 'allow' | 'deny', always: boolean, message?: string): void {
    const session = this.require(key);
    if (!session) return;
    if (session.answerPermission(requestId, behavior, always, message)) return;
    this.emit({ type: 'error', key, message: `no pending permission ${requestId}` });
  }

  async interrupt(key: string): Promise<void> {
    const session = this.require(key);
    if (!session?.query) return;
    await session.query.interrupt().catch((error: unknown) => {
      this.emit({ type: 'error', key, message: `interrupt failed: ${String(error)}` });
    });
  }

  stop(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    session.stop();
  }

  stopAll(): void {
    const keys = Array.from(this.sessions.keys());
    for (const key of keys) this.stop(key);
  }

  private require(key: string): LiveSession | null {
    const session = this.sessions.get(key);
    if (session) return session;
    this.emit({ type: 'error', key, message: 'no such live session' });
    return null;
  }
}
