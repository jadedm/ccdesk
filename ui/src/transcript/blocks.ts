// The block model every transcript source reduces to. History records from the SDK's
// session store and live SDK messages both end up here, so one renderer serves both.

export type ToolResult = { text: string; isError: boolean; lines: number };

export type Block =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string; streaming: boolean }
  | { kind: 'thinking'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown>; summary: string; result?: ToolResult; streaming: boolean }
  | { kind: 'note'; id: string; text: string; tone: 'info' | 'error' };

export type Turn = { id: string; blocks: Block[] };

export type Transcript = { turns: Turn[]; model?: string; version?: string };

export const emptyTranscript = (): Transcript => ({ turns: [] });
