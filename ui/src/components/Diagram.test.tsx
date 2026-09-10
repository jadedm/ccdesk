// Diagrams render through mermaid, which needs a real DOM; jsdom carries enough of one for
// mermaid to produce svg, so these exercise the component rather than mocking it away.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Diagram } from './Diagram.tsx';
import { resetMermaid } from '../transcript/mermaid.ts';

afterEach(() => {
  cleanup();
  resetMermaid();
});

const valid = 'graph TD\n  A[Start] --> B[Finish]';

describe('Diagram', () => {
  it('renders a valid diagram as svg and keeps its source one click away', async () => {
    const user = userEvent.setup();
    const { container } = render(<Diagram source={valid} theme="light" streaming={false} />);
    await waitFor(() => expect(container.querySelector('.diagram-svg svg')).toBeTruthy(), { timeout: 15000 });
    expect(container.querySelector('.diagram-source')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show source' }));
    expect(container.querySelector('.diagram-source')?.textContent).toBe(valid);
    await user.click(screen.getByRole('button', { name: 'Hide source' }));
    expect(container.querySelector('.diagram-source')).toBeNull();
  }, 20000);

  it('shows the source and the reason when a diagram will not parse, never an empty box', async () => {
    const { container } = render(<Diagram source={'graph TD\n  A --> ['} theme="light" streaming={false} />);
    await waitFor(() => expect(container.querySelector('.diagram-error')).toBeTruthy(), { timeout: 15000 });
    expect(container.querySelector('.diagram-source')?.textContent).toBe('graph TD\n  A --> [');
    expect(container.querySelector('.diagram-svg')).toBeNull();
  }, 20000);

  it('leaves a half-written diagram alone while the reply is still arriving', async () => {
    const { container } = render(<Diagram source={'graph T'} theme="light" streaming={true} />);
    // The source is shown, and nothing is rendered or reported as an error yet.
    expect(container.querySelector('.diagram-source')?.textContent).toBe('graph T');
    await new Promise((r) => setTimeout(r, 300));
    expect(container.querySelector('.diagram-error')).toBeNull();
    expect(container.querySelector('.diagram-svg')).toBeNull();
  }, 20000);
});
