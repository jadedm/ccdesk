#!/usr/bin/env bash
# Copies the Claude Code binary that ships inside the Agent SDK into the Tauri resources
# folder so the packaged app carries the CLI version the SDK was built against.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$(find "$root/sidecar/node_modules/.pnpm" -path "*claude-agent-sdk-darwin-*/claude" -type f | head -1)"
if [ -z "$src" ]; then src="$root/sidecar/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude"; fi
test -f "$src" || { echo "no bundled claude binary found under sidecar/node_modules" >&2; exit 1; }
mkdir -p "$root/src-tauri/resources"
cp "$src" "$root/src-tauri/resources/claude"
chmod +x "$root/src-tauri/resources/claude"
echo "copied $(du -h "$root/src-tauri/resources/claude" | cut -f1) from $src"
