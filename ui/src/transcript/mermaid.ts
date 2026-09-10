// Mermaid rendering, kept out of the component so the rules are testable and the library is
// loaded only when a transcript actually contains a diagram.

export type Theme = 'light' | 'dark';

/** Mermaid is large, so it arrives on first use and is initialised once per theme. */
let loading: Promise<typeof import('mermaid')> | null = null;
let configuredFor: Theme | null = null;

const palettes: Record<Theme, Record<string, string>> = {
  light: {
    background: '#f4f1e9',
    primaryColor: '#fffdf8',
    primaryTextColor: '#211e18',
    primaryBorderColor: '#d5cdb9',
    lineColor: '#8a8272',
    secondaryColor: '#efeadc',
    tertiaryColor: '#eae3d3',
    noteBkgColor: '#efeadc',
    noteTextColor: '#514c42',
    noteBorderColor: '#d5cdb9',
  },
  dark: {
    background: '#15140f',
    primaryColor: '#211f18',
    primaryTextColor: '#eae4d6',
    primaryBorderColor: '#3a362b',
    lineColor: '#867e6c',
    secondaryColor: '#28251d',
    tertiaryColor: '#2c2921',
    noteBkgColor: '#211f18',
    noteTextColor: '#b0a996',
    noteBorderColor: '#3a362b',
  },
};

export const loadMermaid = async (theme: Theme) => {
  // A failed import must not stay cached. `loading ??= import(...)` would keep the rejected
  // promise, so one bad load would make every later diagram in the session fail the same way.
  loading ??= import('mermaid').catch((error: unknown) => {
    loading = null;
    throw error;
  });
  const { default: mermaid } = await loading;
  if (configuredFor !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: { fontFamily: '"Newsreader Variable", Georgia, serif', fontSize: '15px', ...palettes[theme] },
    });
    configuredFor = theme;
  }
  return mermaid;
};

/** For tests: forget the loaded instance so a theme change can be observed. */
export const resetMermaid = (): void => {
  loading = null;
  configuredFor = null;
  counter = 0;
};

// Mermaid keeps its parsed directives and its resolved configuration in module-level state, and
// clears them at the start of every render. Two renders in flight therefore share one
// configuration, and which of them wins depends on how they interleave. Diagrams are rendered one
// after another for that reason. It also keeps a reply full of diagrams from starting dozens of
// layouts at once, each of which puts a real element in the document and forces layout.
let queue: Promise<unknown> = Promise.resolve();

const oneAtATime = <T,>(work: () => Promise<T>): Promise<T> => {
  const run = queue.then(work, work);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

export type DiagramResult = { svg: string } | { error: string };

let counter = 0;

/** Renders one diagram. A failure is a value, not a throw: half-written mermaid is the normal
 * state while a reply is still streaming in. */
export const renderDiagram = async (source: string, theme: Theme): Promise<DiagramResult> => {
  const text = source.trim();
  if (text === '') return { error: 'Empty diagram.' };
  return oneAtATime(() => renderOne(text, theme));
};

const renderOne = async (text: string, theme: Theme): Promise<DiagramResult> => {
  const id = `ccdesk-diagram-${++counter}`;
  try {
    const mermaid = await loadMermaid(theme);
    const { svg } = await mermaid.render(id, text);
    return { svg };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    // Mermaid leaves its measuring node behind when a parse fails. Remove only this render's own
    // node: matching the shared prefix deleted the node another diagram was still measuring
    // inside, and a reply with several diagrams renders them at the same time. Measured before
    // the fix: eight concurrent diagrams, seven failed with "Cannot read properties of null".
    document.getElementById(`d${id}`)?.remove();
  }
};
