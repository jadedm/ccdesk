import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { startServer } from './server.ts';

/** CCDESK_CLAUDE_BIN wins. Otherwise the user's own `claude` on PATH, which is what dev runs use. */
const claudeBinary = (): string | undefined => {
  if (process.env.CCDESK_CLAUDE_BIN) return process.env.CCDESK_CLAUDE_BIN;
  const onPath = (process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, 'claude'));
  return onPath.find((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
};

declare const __SDK_VERSION__: string | undefined;

const sdkVersion = (): string => (typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : 'unknown');

const main = async (): Promise<void> => {
  // The shell closes our stdin to say quit. Listen before anything else so a parent that
  // dies while we are still starting up never leaves an orphan behind.
  let shutdown: () => void = () => process.exit(0);
  process.stdin.on('end', () => shutdown());
  process.stdin.resume();

  const server = await startServer({
    indexPath: process.env.CCDESK_INDEX ?? join(homedir(), '.ccdesk', 'index.json'),
    sdkVersion: sdkVersion(),
    claudeBinary: claudeBinary(),
    port: process.env.CCDESK_PORT ? Number(process.env.CCDESK_PORT) : undefined,
    token: process.env.CCDESK_TOKEN || undefined,
  });
  process.stdout.write(JSON.stringify({ port: server.port, token: server.token }) + '\n');
  // Exit within a bounded time whatever the SDK children are doing; the shell only waits
  // three seconds before killing the process anyway.
  shutdown = (): void => {
    setTimeout(() => process.exit(0), 2_500).unref();
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown());
  process.on('SIGINT', () => shutdown());
};

// The sidecar hosts every live session, so one failure inside the SDK (a spawn error
// surfacing as an unhandled 'error' event, for example) must not take the process down.
// Log it; the affected session reports its own failure over the socket.
const describe = (error: unknown): string => (error instanceof Error ? error.stack ?? error.message : String(error));
process.on('uncaughtException', (error) => process.stderr.write(`uncaught: ${describe(error)}\n`));
process.on('unhandledRejection', (error) => process.stderr.write(`unhandled rejection: ${describe(error)}\n`));

main().catch((error: unknown) => {
  process.stderr.write(`sidecar failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
