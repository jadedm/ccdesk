/** Which fenced code blocks are diagrams. Only an explicit mermaid fence counts: guessing
 * from content would turn prose about mermaid into a broken diagram. */
export const isMermaid = (className: string | undefined): boolean =>
  (className ?? '').split(/\s+/).includes('language-mermaid');

/** The text of a fenced block, as written, with the trailing newline markdown adds removed. */
export const fenceText = (children: unknown): string => {
  if (typeof children === 'string') return children.replace(/\n$/, '');
  if (Array.isArray(children)) return children.filter((c): c is string => typeof c === 'string').join('').replace(/\n$/, '');
  return '';
};
