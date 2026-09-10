// Interaction tests: the render-only cases cannot see the submit guard, and a component whose
// blocking reason was replaced by null passed every one of them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddForm } from './AddForm.tsx';
import type { DirectoryReport } from '../../../shared/protocol.ts';

// Auto-cleanup needs vitest globals, which this project does not enable.
afterEach(cleanup);

const report = (over: Partial<DirectoryReport>): DirectoryReport => ({ path: '/p', exists: true, isDirectory: true, readable: true, sessions: 0, problem: null, ...over });

describe('AddForm submit guard', () => {
  it('refuses to create a workspace whose directory does not exist, and says why', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const describe = vi.fn(async (path: string) => report({ path, exists: false, isDirectory: false, readable: false, problem: 'missing' }));
    render(<AddForm kind="workspace" describe={describe} onSubmit={onSubmit} onCancel={() => {}} />);

    await user.type(screen.getByLabelText(/^directory/i), '/nope/gone');
    await waitFor(() => expect(screen.getByText(/No such directory/i)).toBeTruthy(), { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText(/No such directory/i).length).toBeGreaterThan(0);
  });

  it('creates with the directory name when no name was typed', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const describe = vi.fn(async (path: string) => report({ path, sessions: 4 }));
    render(<AddForm kind="workspace" describe={describe} onSubmit={onSubmit} onCancel={() => {}} />);

    await user.type(screen.getByLabelText(/^directory/i), '/Users/ada/code/widgets');
    await waitFor(() => expect(screen.getByText(/4 Claude Code sessions/i)).toBeTruthy(), { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'widgets', cwd: '/Users/ada/code/widgets' });
  });

  it('will not save while the directory is still being checked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const describe = vi.fn(() => new Promise<DirectoryReport>(() => {}));
    render(<AddForm kind="workspace" describe={describe} onSubmit={onSubmit} onCancel={() => {}} />);
    await user.type(screen.getByLabelText(/^directory/i), '/slow/path');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Checking that directory/i)).toBeTruthy();
  });

  it('keeps the form and the typing when the sidecar refuses', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => { throw new Error('directory_not_found'); });
    render(<AddForm kind="folder" onSubmit={onSubmit} onCancel={() => {}} />);
    await user.type(screen.getByLabelText(/^name/i), 'my folder');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.getByText(/Could not save/i)).toBeTruthy());
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe('my folder');
  });

  it('cancels on Escape from a button, not only from a field', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<AddForm kind="session" onSubmit={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    onCancel.mockClear();
    screen.getByRole('button', { name: 'Create' }).focus();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
