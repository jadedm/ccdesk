import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { startServer } from './server.ts';

const sdkVersion = (): string => {
  const require = createRequire(import.meta.url);
  try {
    const pkg = require('@anthropic-ai/claude-agent-sdk/package.json') as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
};

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
