#!/usr/bin/env bash
# Copies the Claude Code binary that ships inside the Agent SDK into the Tauri resources
# folder so the packaged app carries the CLI version the SDK was built against.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
case "$(uname -m)" in
  arm64) platform="darwin-arm64" ;;
  x86_64) platform="darwin-x64" ;;
  *) echo "unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
# pnpm keeps the real package under node_modules/.pnpm at the workspace root; older layouts
# put it under the package's own node_modules.
src="$(find "$root/node_modules/.pnpm" "$root/sidecar/node_modules/.pnpm" -path "*claude-agent-sdk-${platform}*/claude" -type f 2>/dev/null | head -1 || true)"
if [ -z "$src" ]; then src="$root/sidecar/node_modules/@anthropic-ai/claude-agent-sdk-${platform}/claude"; fi
test -f "$src" || { echo "no bundled claude binary for ${platform} under node_modules" >&2; exit 1; }
mkdir -p "$root/src-tauri/resources"
cp "$src" "$root/src-tauri/resources/claude"
chmod +x "$root/src-tauri/resources/claude"
echo "copied $(du -h "$root/src-tauri/resources/claude" | cut -f1) from $src"
