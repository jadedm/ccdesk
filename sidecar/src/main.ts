import { homedir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './server.ts';

declare const __SDK_VERSION__: string | undefined;

const sdkVersion = (): string => (typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : 'unknown');

const main = async (): Promise<void> => {
  const server = await startServer({
    indexPath: process.env.CCDESK_INDEX ?? join(homedir(), '.ccdesk', 'index.json'),
    sdkVersion: sdkVersion(),
    claudeBinary: process.env.CCDESK_CLAUDE_BIN,
    port: process.env.CCDESK_PORT ? Number(process.env.CCDESK_PORT) : undefined,
  });
  process.stdout.write(JSON.stringify({ port: server.port, token: server.token }) + '\n');
  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.stdin.on('end', shutdown);
  process.stdin.resume();
};

main().catch((error: unknown) => {
  process.stderr.write(`sidecar failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
