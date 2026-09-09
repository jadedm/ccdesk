# ccdesk

Claude Code desktop wrapper built for readability. Tauri 2 shell, React UI, Node sidecar on
the Claude Agent SDK. Epic: #1.

## Layout

- `sidecar/` Node. HTTP plus WebSocket on 127.0.0.1 with a bearer token. One `query()` per live
  session. Reads the CLI's own session store via the SDK. Bundled by esbuild to `dist/sidecar.cjs`.
- `ui/` React with Vite. `src/transcript/reduce.ts` is the one reducer that turns history records
  and live SDK messages into the block model. Everything rendered goes through it.
- `shared/protocol.ts` the wire types both sides import.
- `src-tauri/` Rust. Spawns `node dist/sidecar.cjs`, reads the port and token banner, exposes
  `sidecar_info`. Kills the sidecar on exit.
- `scripts/prepare-resources.sh` copies the SDK's bundled `claude` binary into
  `src-tauri/resources/` (gitignored) for the packaged app.

## Commands

```
pnpm install --frozen-lockfile
pnpm lint            # oxlint --fix, both packages
pnpm lint:check
pnpm typecheck
pnpm test            # unit; live SDK cases skip unless CCDESK_LIVE=1
pnpm test:live       # real API turns, a few minutes
pnpm build           # sidecar bundle and ui dist
./scripts/prepare-resources.sh
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm tauri dev
pnpm tauri build     # unsigned .app under src-tauri/target/release/bundle/macos
```

Browser dev mode without Tauri: run `CCDESK_TOKEN=dev node sidecar/dist/sidecar.cjs`, take the
port from its first stdout line, run `pnpm --filter ui dev`, open
`http://localhost:1420/?port=<port>&token=dev`. The token in the URL is a dev convenience;
the packaged app hands it to the webview through `sidecar_info` instead.

## Conventions

- Solo repo. Integration branch is `main`. Step 12 of the loop (team review) is N/A.
- Squash merge, delete branch.
- The CLI's JSONL session files are never written by ccdesk. A new session's name goes in
  as the SDK's `title` on `query()`; a rename goes through `renameSession`. Either way the
  terminal `/resume` picker shows the same title, and a resumed session keeps its stored one.
- `settingSources` is `user, project, local` and the system prompt is the `claude_code`
  preset, so CLAUDE.md, hooks, skills and MCP servers load as in the terminal.
- Requires Node 22 and a Claude Code login under `~/.claude`. The sidecar's stderr goes to
  `~/Library/Logs/com.manishj.ccdesk/sidecar.log` in the packaged app.
