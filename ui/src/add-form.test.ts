import { describe, expect, it } from 'vitest';
import { directoryNote, hasContent, reasonNotReady, rulesFor } from './add-form.ts';

describe('add form rules', () => {
  it('says what is missing rather than staying silent', () => {
    const ws = rulesFor('workspace');
    expect(reasonNotReady(ws, { name: '', cwd: '' })).toBe('Give it a name.');
    expect(reasonNotReady(ws, { name: 'Work', cwd: '' })).toBe('Choose the directory this workspace covers.');
    expect(reasonNotReady(ws, { name: 'Work', cwd: 'relative/path' })).toContain('full path');
    expect(reasonNotReady(ws, { name: 'Work', cwd: '/abs' })).toBeNull();
  });

  it('lets a folder skip the directory and a session skip the name', () => {
    expect(reasonNotReady(rulesFor('folder'), { name: 'proj', cwd: '' })).toBeNull();
    expect(reasonNotReady(rulesFor('folder'), { name: '', cwd: '/abs' })).toBe('Give it a name.');
    expect(reasonNotReady(rulesFor('session'), { name: '', cwd: '' })).toBeNull();
    // A bad path is still a bad path wherever it is typed.
    expect(reasonNotReady(rulesFor('folder'), { name: 'proj', cwd: 'nope' })).toContain('full path');
  });

  it('turns a directory report into something a user can act on', () => {
    expect(directoryNote(null)).toBeNull();
    expect(directoryNote({ exists: false, isDirectory: false, sessions: 0 })).toMatchObject({ tone: 'warn' });
    expect(directoryNote({ exists: true, isDirectory: false, sessions: 0 })?.text).toContain('file');
    expect(directoryNote({ exists: true, isDirectory: true, sessions: 0 })?.text).toContain('No Claude Code sessions');
    expect(directoryNote({ exists: true, isDirectory: true, sessions: 1 })?.text).toBe('1 Claude Code session already here.');
    expect(directoryNote({ exists: true, isDirectory: true, sessions: 7 })?.text).toBe('7 Claude Code sessions already here.');
  });

  it('knows when a form holds work worth protecting', () => {
    expect(hasContent({ name: '', cwd: '' })).toBe(false);
    expect(hasContent({ name: '  ', cwd: '' })).toBe(false);
    expect(hasContent({ name: 'x', cwd: '' })).toBe(true);
    expect(hasContent({ name: '', cwd: '/a' })).toBe(true);
  });
});
