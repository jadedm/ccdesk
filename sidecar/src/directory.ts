// What the app can say about a directory before the user commits to it: does it exist, is it
// a directory, and how many Claude Code sessions does it already hold. A workspace pointed at
// a typo looks identical to an empty one otherwise.
//
// "Cannot read it" is not "does not exist". On macOS the user's own Documents, Desktop and
// Downloads answer EPERM until the app is granted access, and reporting those as missing
// would refuse the very directories most people want.

import { stat } from 'node:fs/promises';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { DirectoryReport } from '../../shared/protocol.ts';

const errorCode = (error: unknown): string => (error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : 'UNKNOWN');

export const describeDirectory = async (path: string): Promise<DirectoryReport> => {
  const info = await stat(path).then((s) => s, (e: unknown) => errorCode(e));
  if (typeof info === 'string') {
    const missing = info === 'ENOENT' || info === 'ENOTDIR';
    return { path, exists: !missing, isDirectory: !missing, readable: false, sessions: 0, problem: missing ? 'missing' : 'unreadable' };
  }
  if (!info.isDirectory()) return { path, exists: true, isDirectory: false, readable: true, sessions: 0, problem: 'not-a-directory' };
  const listed = await listSessions({ dir: path }).then((s) => s.length, () => null);
  return { path, exists: true, isDirectory: true, readable: listed !== null, sessions: listed ?? 0, problem: listed === null ? 'unreadable' : null };
};
