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
  loading ??= import('mermaid');
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
};

export type DiagramResult = { svg: string } | { error: string };

let counter = 0;

/** Renders one diagram. A failure is a value, not a throw: half-written mermaid is the normal
 * state while a reply is still streaming in. */
export const renderDiagram = async (source: string, theme: Theme): Promise<DiagramResult> => {
  const text = source.trim();
  if (text === '') return { error: 'Empty diagram.' };
  try {
    const mermaid = await loadMermaid(theme);
    const { svg } = await mermaid.render(`ccdesk-diagram-${++counter}`, text);
    return { svg };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    // Mermaid leaves its measuring node behind when a parse fails.
    document.querySelectorAll('[id^="dccdesk-diagram-"]').forEach((node) => node.remove());
  }
};
