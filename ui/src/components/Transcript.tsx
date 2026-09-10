import { memo, useEffect, useRef, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { bionicNodes } from '../transcript/bionic.ts';
import type { Block, Transcript as TranscriptModel } from '../transcript/blocks.ts';
import { toolDisplayName } from '../transcript/summaries.ts';
import type { Theme } from '../transcript/mermaid.ts';
import { keepAtBottom, visible, type View } from '../transcript/view.ts';
import { fenceText, isMermaid, isMermaidFence } from '../transcript/mermaid-block.ts';
import { Diagram } from './Diagram.tsx';

const clock = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const ToolLine = ({ block }: { block: Extract<Block, { kind: 'tool' }> }) => {
  const count = block.result
    ? block.result.isError
      ? 'error'
      : `${block.result.lines} line${block.result.lines === 1 ? '' : 's'}`
    : block.streaming
      ? 'running'
      : 'no result';
  const countClass = block.result?.isError ? 'count error' : block.result ? 'count' : 'count pending';
  return (
    <details className="tool">
      <summary>
        <span className="name">{toolDisplayName(block.name)}</span>
        <span className="sum">{block.summary}</span>
        <span className={countClass}>{count}</span>
      </summary>
      <div className="body">
        <h4>Input</h4>
        <pre>{formatInput(block.input)}</pre>
        {block.result && (
          <>
            <h4>{block.result.isError ? 'Error' : 'Result'}</h4>
            <pre>{block.result.text || '(empty)'}</pre>
          </>
        )}
      </div>
    </details>
  );
};

const formatInput = (input: Record<string, unknown>): string => {
  const keys = Object.keys(input);
  if (keys.length === 1 && typeof input[keys[0]] === 'string') return `${keys[0]}: ${input[keys[0]] as string}`;
  return keys.map((k) => `${k}: ${typeof input[k] === 'string' ? input[k] : JSON.stringify(input[k], null, 2)}`).join('\n');
};

// Bionic mode rewrites plain text inside paragraphs and list items; code, links and
// emphasis keep their own rendering.
const bionify = (children: ReactNode): ReactNode => {
  if (typeof children === 'string') return bionicNodes(children);
  if (Array.isArray(children)) return children.map((c, i) => (typeof c === 'string' ? <span key={i}>{bionicNodes(c)}</span> : c));
  return children;
};

const bionicComponents: Components = {
  p: ({ children, node: _node, ...rest }) => <p {...rest}>{bionify(children)}</p>,
  li: ({ children, node: _node, ...rest }) => <li {...rest}>{bionify(children)}</li>,
  td: ({ children, node: _node, ...rest }) => <td {...rest}>{bionify(children)}</td>,
};

/** A mermaid fence becomes a diagram; every other fence keeps its code rendering. Bionic mode
 * never touches either, since neither is prose.
 *
 * The `pre` override matters as much as the `code` one: markdown wraps every fence in a `pre`, and
 * a diagram left inside that wrapper is drawn in the code-block box, with a `div` inside a `pre`
 * and the source `pre` nested inside that. */
const codeComponents = (theme: Theme, streaming: boolean): Components => ({
  pre: ({ children, node: _node, ...rest }) =>
    isMermaidFence(children) ? <>{children}</> : <pre {...rest}>{children}</pre>,
  code: ({ className, children, node: _node, ...rest }) =>
    isMermaid(className) ? <Diagram source={fenceText(children)} theme={theme} streaming={streaming} /> : <code className={className} {...rest}>{children}</code>,
});

/** Small mono line above a block: who, and when. */
const Role = ({ who, at }: { who: string; at?: string }) => (
  <div className="role">
    <span className="who">{who}</span>
    {at && <span className="time">{clock(at)}</span>}
  </div>
);

const BlockView = memo(({ block, bionic, theme }: { block: Block; bionic: boolean; theme: Theme }) => {
  switch (block.kind) {
    case 'user':
      return (
        <>
          <Role who="you" at={block.at} />
          <div className="user">{block.text}</div>
        </>
      );
    case 'text':
      return (
        <div className={block.streaming ? 'prose streaming' : 'prose'}>
          <Markdown remarkPlugins={[remarkGfm]} components={{ ...(bionic ? bionicComponents : {}), ...codeComponents(theme, block.streaming) }}>{block.text}</Markdown>
        </div>
      );
    case 'thinking':
      return (
        <details className="thinking">
          <summary>thinking{block.streaming ? '…' : ''}</summary>
          <div className="body">{block.text}</div>
        </details>
      );
    case 'tool':
      return <ToolLine block={block} />;
    case 'system':
      return (
        <details className="system">
          <summary>
            <span className="tag">{block.tag}</span>
            <span className="hint">{block.text.length} chars</span>
          </summary>
          <pre>{block.text}</pre>
        </details>
      );
    case 'note':
      return <div className={block.tone === 'error' ? 'note error' : 'note'}>{block.text}</div>;
  }
});

export { BlockView, Role };

const isReply = (b: Block): boolean => b.kind === 'text' || b.kind === 'thinking' || b.kind === 'tool';

type TranscriptProps = {
  transcript: TranscriptModel;
  view: View;
  /** Identifies the session shown; a change resets the scroll position to the top. */
  sessionKey: string;
  /** True while a turn is running, the only time the view follows the end. */
  following: boolean;
  /** 1-based turn to bring into view, from a search hit; the token makes a repeat request new. */
  scrollTo?: { turn: number; token: number } | null;
};

export const Transcript = ({ transcript, view, sessionKey, following, scrollTo }: TranscriptProps) => {
  const scroller = useRef<HTMLDivElement>(null);
  const distance = useRef(0);
  const lastTurn = transcript.turns[transcript.turns.length - 1];
  const lastBlock = lastTurn?.blocks[lastTurn.blocks.length - 1];
  const tail = lastBlock && 'text' in lastBlock ? lastBlock.text.length : 0;

  const onScroll = () => {
    const el = scroller.current;
    if (el) distance.current = el.scrollHeight - el.scrollTop - el.clientHeight;
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = 0;
    distance.current = el.scrollHeight - el.clientHeight;
  }, [sessionKey]);

  const targetTurn = transcript.turns[(scrollTo?.turn ?? 0) - 1]?.id;
  useEffect(() => {
    if (!targetTurn) return;
    document.getElementById(targetTurn)?.scrollIntoView({ block: 'start' });
  }, [targetTurn, scrollTo?.token]);

  // A prompt the reader just sent always brings the reply into view; streaming after that
  // follows only while they stay near the bottom.
  const justPrompted = lastBlock?.kind === 'user';
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (!(following && justPrompted) && !keepAtBottom(following, distance.current)) return;
    el.scrollTop = el.scrollHeight;
    distance.current = 0;
  }, [transcript.turns.length, tail, following, justPrompted]);

  if (transcript.turns.length === 0) return <div className="transcript"><div className="empty">No messages yet.</div></div>;
  return (
    <div className="transcript" ref={scroller} onScroll={onScroll}>
      <div className="reading">
        {transcript.turns.map((turn) => {
          const shown = turn.blocks.filter((b) => visible(b, view));
          // The claude label goes before the first reply block that is actually visible, so a
          // hidden thinking block never swallows it.
          const labelBefore = turn.replyAt ? shown.find(isReply)?.id : undefined;
          return (
            <section className="turn" key={turn.id} id={turn.id}>
              {shown.map((block) => (
                <span key={block.id} style={{ display: 'contents' }}>
                  {block.id === labelBefore && <Role who="claude" at={turn.replyAt} />}
                  <BlockView block={block} bionic={view.bionic} theme={view.theme} />
                </span>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
};
