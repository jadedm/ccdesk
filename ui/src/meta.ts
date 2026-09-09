export type RowMeta = { lastModified?: number; messages?: number; model?: string | null };

const shortModel = (model?: string | null): string => (model ? model.replace(/^claude-/, '') : '');

const when = (ms?: number): string => {
  if (!ms) return '';
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = d.toLocaleDateString([], sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${day}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

/** Date, message count and model under a session title, the way the reader lists sessions. */
export const metaLine = (m: RowMeta): string =>
  [when(m.lastModified), m.messages !== undefined ? `${m.messages} msgs` : '', shortModel(m.model)].filter(Boolean).join('  ');
