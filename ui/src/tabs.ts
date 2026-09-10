// Tab order and navigation, pure so the reducer and the keyboard handler share one rule set.

/** The tab list after opening a key: appended once, never duplicated. */
export const withOpened = (open: string[], key: string): string[] => (open.includes(key) ? open : [...open, key]);

/** The tab list and the key to focus after closing one. Closing the active tab focuses its
 * left neighbour, or the right one when it was first, or nothing when it was the last. */
export const withClosed = (open: string[], active: string | null, key: string): { open: string[]; active: string | null } => {
  const index = open.indexOf(key);
  if (index === -1) return { open, active };
  const remaining = open.filter((k) => k !== key);
  if (active !== key) return { open: remaining, active };
  const next = remaining[index - 1] ?? remaining[index] ?? null;
  return { open: remaining, active: next };
};

/** The tab after or before the active one, wrapping at the ends. */
export const cycle = (open: string[], active: string | null, direction: 1 | -1): string | null => {
  if (open.length === 0) return null;
  const index = active ? open.indexOf(active) : -1;
  if (index === -1) return open[0];
  return open[(index + direction + open.length) % open.length];
};

/** What closing a session entails. A live one is stopped on the sidecar, a running one only
 * after the user confirms; a saved one just leaves memory. */
export type CloseDecision = { close: boolean; stop: boolean };

export const closeDecision = (status: string, confirm: () => boolean): CloseDecision => {
  const running = status === 'running' || status === 'starting';
  if (running && !confirm()) return { close: false, stop: false };
  return { close: true, stop: status !== 'history' };
};
