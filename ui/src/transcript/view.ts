import type { Block } from './blocks.ts';

export type View = { hideThinking: boolean; showTools: boolean; showSystem: boolean; bionic: boolean; theme: 'light' | 'dark' };

/** Which blocks the current toggles let through. Prose and user turns always show. */
export const visible = (block: Block, view: View): boolean => {
  if (block.kind === 'tool') return view.showTools;
  if (block.kind === 'system') return view.showSystem;
  if (block.kind === 'thinking') return !view.hideThinking;
  return true;
};

/** Follow the end of the transcript only while a turn is running and the reader is already
 * near the bottom. A saved session opens at the top and stays wherever it was scrolled. */
export const keepAtBottom = (following: boolean, distanceFromBottom: number): boolean => following && distanceFromBottom < 160;
