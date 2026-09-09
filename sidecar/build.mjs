// Bundles the sidecar to one CommonJS file. The SDK version is baked in at build time
// because the bundle has no import.meta.url to resolve package.json from at runtime.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

// The SDK's exports map hides package.json, so read it by path.
const sdk = JSON.parse(readFileSync(new URL('./node_modules/@anthropic-ai/claude-agent-sdk/package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/sidecar.cjs',
  external: ['@anthropic-ai/claude-agent-sdk'],
  define: { __SDK_VERSION__: JSON.stringify(sdk.version) },
});
