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

/** Whether the single child of a markdown `pre` is a mermaid fence.
 *
 * `react-markdown` wraps every fenced block in a `pre`. A diagram is not code, and leaving that
 * wrapper in place puts a `div` inside a `pre`, nests the source `pre` inside it, and draws every
 * diagram inside the code-block box. This is how the `pre` renderer decides to step aside. */
export const isMermaidFence = (children: unknown): boolean => {
  const only = Array.isArray(children) ? children.find((c) => typeof c === 'object' && c !== null) : children;
  if (typeof only !== 'object' || only === null) return false;
  const props = (only as { props?: unknown }).props;
  if (typeof props !== 'object' || props === null) return false;
  const className = (props as { className?: unknown }).className;
  return isMermaid(typeof className === 'string' ? className : undefined);
};
