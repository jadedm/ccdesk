import { memo, useEffect, useRef, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import { bionicNodes } from '../transcript/bionic.ts';
import remarkGfm from 'remark-gfm';
import type { Block, Transcript as TranscriptModel } from '../transcript/blocks.ts';
import { toolDisplayName } from '../transcript/summaries.ts';

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

// Memoised: blocks are copied only when they change, so unchanged blocks skip the markdown parse.
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

const BlockView = memo(({ block, bionic }: { block: Block; bionic: boolean }) => {
  switch (block.kind) {
    case 'user':
      return <div className="user">{block.text}</div>;
    case 'text':
      return (
        <div className={block.streaming ? 'prose streaming' : 'prose'}>
          <Markdown remarkPlugins={[remarkGfm]} components={bionic ? bionicComponents : undefined}>{block.text}</Markdown>
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
    case 'note':
      return <div className={block.tone === 'error' ? 'note error' : 'note'}>{block.text}</div>;
  }
});

export { BlockView };

export const Transcript = ({ transcript, hideThinking, bionic }: { transcript: TranscriptModel; hideThinking: boolean; bionic: boolean }) => {
  const bottom = useRef<HTMLDivElement>(null);
  const lastTurn = transcript.turns[transcript.turns.length - 1];
  const lastBlock = lastTurn?.blocks[lastTurn.blocks.length - 1];
  const tail = lastBlock && 'text' in lastBlock ? lastBlock.text.length : 0;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [transcript.turns.length, tail]);

  if (transcript.turns.length === 0) return <div className="transcript"><div className="empty">No messages yet.</div></div>;
  return (
    <div className={hideThinking ? 'transcript hide-thinking' : 'transcript'}>
      <div className="reading">
        {transcript.turns.map((turn, i) => (
          <section className="turn" key={turn.id} id={turn.id}>
            <div className="turn-index">{i + 1}</div>
            {turn.blocks.map((block) => (
              <BlockView block={block} bionic={bionic} key={block.id} />
            ))}
          </section>
        ))}
        <div ref={bottom} />
      </div>
    </div>
  );
};
