import { useEffect, useState } from 'react';
import { renderDiagram, type Theme } from '../transcript/mermaid.ts';

/** A mermaid diagram, with its source one click away. While a reply is still arriving the
 * source is half-written and will not parse, so the failed state shows the source and the
 * reason rather than an empty box, and a diagram that once rendered is kept on screen until
 * a newer one replaces it. */
export const Diagram = ({ source, theme, streaming }: { source: string; theme: Theme; streaming: boolean }) => {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    // A diagram that is still being typed is not worth rendering on every keystroke.
    if (streaming) return;
    // Renders are queued, so a result can arrive long after its source was replaced. The cleanup
    // flag is what discards those.
    let current = true;
    void renderDiagram(source, theme).then((result) => {
      if (!current) return;
      if ('svg' in result) {
        setSvg(result.svg);
        setError(null);
        return;
      }
      setError(result.error);
    });
    return () => {
      current = false;
    };
  }, [source, theme, streaming]);

  const failed = error !== null && svg === null;
  return (
    <div className="diagram">
      {svg && !failed && <div className="diagram-svg" dangerouslySetInnerHTML={{ __html: svg }} />}
      {(failed || streaming) && (
        <pre className="diagram-source">{source}</pre>
      )}
      {failed && <div className="diagram-error">This diagram did not render: {error}</div>}
      {svg && !failed && (
        <>
          <button type="button" className="diagram-toggle" onClick={() => setShowSource((s) => !s)}>
            {showSource ? 'Hide source' : 'Show source'}
          </button>
          {showSource && <pre className="diagram-source">{source}</pre>}
        </>
      )}
    </div>
  );
};
