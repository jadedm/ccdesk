import type { Block } from './blocks.ts';

export type View = { hideThinking: boolean; showTools: boolean; showSystem: boolean; bionic: boolean };

/** Which blocks the current toggles let through. Prose and user turns always show. */
export const visible = (block: Block, view: View): boolean => {
  if (block.kind === 'tool') return view.showTools;
  if (block.kind === 'system') return view.showSystem;
  if (block.kind === 'thinking') return !view.hideThinking;
  return true;
};
