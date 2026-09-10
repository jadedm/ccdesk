// The hint used to be a second .composer row with its top padding zeroed, so it inherited the
// flex rules of the row that holds the field and its button. These cases pin the shape the CSS
// depends on; the pixel heights themselves are measured in the browser, since jsdom has no
// layout engine and reports every height as zero.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer } from './Composer.tsx';
import type { SessionStatus } from '../state.ts';

afterEach(cleanup);

const mount = (status: SessionStatus) =>
  render(
    <Composer status={status} permission={null} onSend={vi.fn()} onInterrupt={vi.fn()} onPermission={vi.fn()} />,
  );

describe('Composer layout', () => {
  it('keeps the hint out of the row that holds the field and its button', () => {
    const { container } = mount('idle');
    const hint = container.querySelector('.composer-hint');
    expect(hint).not.toBeNull();
    expect(hint?.closest('.composer')).toBeNull();
    expect(container.querySelectorAll('.composer').length).toBe(1);
  });

  it('puts the field and its button in that one row, and nothing else', () => {
    const { container } = mount('idle');
    const row = container.querySelector('.composer');
    expect(row?.querySelector('textarea')).not.toBeNull();
    expect(row?.querySelectorAll('button').length).toBe(1);
    expect(row?.children.length).toBe(2);
  });

  it('shows Interrupt in the same row while a turn runs', () => {
    const { container } = mount('running');
    const row = container.querySelector('.composer');
    expect(row?.querySelector('button')?.textContent).toBe('Interrupt');
    expect(row?.querySelectorAll('button').length).toBe(1);
  });

  it('changes the hint wording for a history session', () => {
    const { container } = mount('history');
    expect(container.querySelector('.composer-hint')?.textContent).toContain('resumes');
    cleanup();
    const live = mount('idle');
    expect(live.container.querySelector('.composer-hint')?.textContent).toContain('Shift Enter');
  });

  it('leaves Send disabled until the field holds something', () => {
    const { container } = mount('idle');
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const field = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: '   ' } });
    expect(send.disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'hello' } });
    expect(send.disabled).toBe(false);
  });
});
