# ccdesk

A desktop wrapper for Claude Code built for reading. Same engine, same sessions, same
permissions as the CLI, rendered so a transcript can be read rather than scrolled.

- Workspaces, folders and named sessions on top of the CLI's own session files.
- Tool calls collapse to one line. Results and thinking hide by default.
- History and live sessions use the same renderer.

Stack: Tauri 2 shell, React UI, Node sidecar running the Claude Agent SDK.

Requires Node 22 and Claude Code installed and logged in.
