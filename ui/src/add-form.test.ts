import { describe, expect, it } from 'vitest';
import { basename, blockingReason, directoryNote, effectiveName, hasContent, reasonNotReady, rulesFor } from './add-form.ts';

describe('add form rules', () => {
  it('says what is missing rather than staying silent', () => {
    const ws = rulesFor('workspace');
    // The directory is asked for first: it is the real choice, and it supplies the name.
    expect(reasonNotReady(ws, { name: '', cwd: '' })).toBe('Choose the directory this workspace covers.');
    expect(reasonNotReady(ws, { name: 'Work', cwd: '' })).toBe('Choose the directory this workspace covers.');
    // Raw, the name is still required; blockingReason is what lets the directory supply it.
    expect(reasonNotReady(ws, { name: '', cwd: '/abs' })).toBe('Give it a name.');
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

describe('name from the directory', () => {
  it('takes the last segment, so picking a directory is usually the whole job', () => {
    expect(basename('/Users/ada/code/widgets')).toBe('widgets');
    expect(basename('/Users/ada/code/widgets/')).toBe('widgets');
    expect(basename('/')).toBe('');
    expect(basename('')).toBe('');
    expect(effectiveName({ name: '', cwd: '/a/b/proj' })).toBe('proj');
    expect(effectiveName({ name: 'Chosen', cwd: '/a/b/proj' })).toBe('Chosen');
  });
});

describe('what blocks a save', () => {
  const ws = rulesFor('workspace');
  const ready = { report: { exists: true, isDirectory: true, sessions: 3 }, pending: false };

  it('accepts a directory whose name stands in for the missing name', () => {
    expect(blockingReason(ws, { name: '', cwd: '/a/b/proj' }, ready)).toBeNull();
    expect(blockingReason(ws, { name: '', cwd: '' }, { report: null, pending: false })).toContain('directory');
  });

  it('refuses to save a directory that does not exist or is a file', () => {
    expect(blockingReason(ws, { name: 'x', cwd: '/a/b' }, { report: { exists: false, isDirectory: false, sessions: 0 }, pending: false })).toContain('No such directory');
    expect(blockingReason(ws, { name: 'x', cwd: '/a/b' }, { report: { exists: true, isDirectory: false, sessions: 0 }, pending: false })).toContain('file');
  });

  it('waits for the check rather than saving into the unknown', () => {
    expect(blockingReason(ws, { name: 'x', cwd: '/a/b' }, { report: null, pending: true })).toBe('Checking that directory…');
    // A folder with no directory at all has nothing to check.
    expect(blockingReason(rulesFor('folder'), { name: 'x', cwd: '' }, { report: null, pending: true })).toBeNull();
  });
});
