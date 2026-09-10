// What the app can say about a directory before the user commits to it: does it exist, is it
// a directory, and how many Claude Code sessions does it already hold. A workspace pointed at
// a typo looks identical to an empty one otherwise.

import { stat } from 'node:fs/promises';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { DirectoryReport } from '../../shared/protocol.ts';

export const describeDirectory = async (path: string): Promise<DirectoryReport> => {
  const info = await stat(path).catch(() => null);
  if (!info || !info.isDirectory()) {
    return { path, exists: info !== null, isDirectory: false, sessions: 0 };
  }
  const sessions = await listSessions({ dir: path }).catch(() => []);
  return { path, exists: true, isDirectory: true, sessions: sessions.length };
};
