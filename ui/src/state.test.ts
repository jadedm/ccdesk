import { describe, expect, it } from 'vitest';
import { initialState, reducer } from './state.ts';

const records = [
  { type: 'user', message: { role: 'user', content: 'first' } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'pong' }] } },
];

describe('state: resuming a saved session', () => {
  it('carries the history transcript into the live view and retires the history entry', () => {
    const opened = reducer(initialState, { type: 'open_history', key: 'hist-1', sessionId: 's1', cwd: '/w', folderId: null, title: 'T', records });
    expect(opened.sessions['hist-1'].transcript.turns).toHaveLength(1);
    const live = reducer(opened, { type: 'new_live', key: 'live-1', cwd: '/w', folderId: null, title: 'T', resume: 's1', fromKey: 'hist-1' });
    expect(live.sessions['hist-1']).toBeUndefined();
    expect(live.sessions['live-1'].transcript.turns).toHaveLength(1);
    expect(live.sessions['live-1'].status).toBe('starting');
    expect(live.activeKey).toBe('live-1');
    const prompted = reducer(live, { type: 'local_prompt', key: 'live-1', text: 'second' });
    expect(prompted.sessions['live-1'].transcript.turns).toHaveLength(2);
    const sent = prompted.sessions['live-1'].transcript.turns[1].blocks[0];
    expect(sent.kind === 'user' && sent.at && !Number.isNaN(Date.parse(sent.at))).toBe(true);
  });

  it('keeps a tab per open session, reuses it on reopen and on resume, and closes to a neighbour', () => {
    let s = reducer(initialState, { type: 'open_history', key: 'hist-a', sessionId: 'a', cwd: '/w', folderId: null, title: 'A', records: [] });
    s = reducer(s, { type: 'new_live', key: 'live-b', cwd: '/w', folderId: null, title: 'B', resume: null });
    s = reducer(s, { type: 'open_history', key: 'hist-c', sessionId: 'c', cwd: '/w', folderId: null, title: 'C', records: [] });
    expect(s.open).toEqual(['hist-a', 'live-b', 'hist-c']);
    s = reducer(s, { type: 'activate', key: 'hist-a' });
    s = reducer(s, { type: 'new_live', key: 'live-a', cwd: '/w', folderId: null, title: 'A', resume: 'a', fromKey: 'hist-a' });
    expect(s.open).toEqual(['live-a', 'live-b', 'hist-c']);
    expect(s.sessions['hist-a']).toBeUndefined();
    s = reducer(s, { type: 'activate', key: 'live-b' });
    s = reducer(s, { type: 'close', key: 'live-b' });
    expect(s.open).toEqual(['live-a', 'hist-c']);
    expect(s.activeKey).toBe('live-a');
    expect(s.sessions['live-b']).toBeUndefined();
    expect(reducer(s, { type: 'close', key: 'nope' })).toBe(s);
  });

  it('starts a fresh session with an empty transcript', () => {
    const live = reducer(initialState, { type: 'new_live', key: 'live-2', cwd: '/w', folderId: 'f', title: 'New', resume: null });
    expect(live.sessions['live-2'].transcript.turns).toEqual([]);
  });

  it('is idle after start-up so the composer offers Send, and running only after a prompt', () => {
    let s = reducer(initialState, { type: 'new_live', key: 'k', cwd: '/w', folderId: null, title: 'N', resume: null });
    expect(s.sessions.k.status).toBe('starting');
    s = reducer(s, { type: 'server', message: { type: 'started', key: 'k', sessionId: 'abc' } });
    expect(s.sessions.k.status).toBe('idle');
    s = reducer(s, { type: 'server', message: { type: 'event', key: 'k', message: { type: 'system', subtype: 'init' } } });
    expect(s.sessions.k.status).toBe('idle');
    s = reducer(s, { type: 'local_prompt', key: 'k', text: 'go' });
    expect(s.sessions.k.status).toBe('running');
    s = reducer(s, { type: 'server', message: { type: 'event', key: 'k', message: { type: 'result', is_error: false } } });
    expect(s.sessions.k.status).toBe('idle');
  });

  it('turns live sessions back into saved ones when the socket reconnects', () => {
    let s = reducer(initialState, { type: 'new_live', key: 'a', cwd: '/w', folderId: null, title: 'A', resume: null });
    s = reducer(s, { type: 'server', message: { type: 'started', key: 'a', sessionId: 'sid-a' } });
    s = reducer(s, { type: 'new_live', key: 'b', cwd: '/w', folderId: null, title: 'B', resume: null });
    s = reducer(s, { type: 'open_history', key: 'h', sessionId: 'sid-h', cwd: '/w', folderId: null, title: 'H', records: [] });
    s = reducer(s, { type: 'socket_reset' });
    expect(s.sessions.a.status).toBe('history');
    expect(s.sessions.a.sessionId).toBe('sid-a');
    expect(s.sessions.b.status).toBe('ended');
    expect(s.sessions.b.error).toContain('lost');
    expect(s.sessions.h.status).toBe('history');
  });

  it('clears the permission card when the user answers and the error when they prompt again', () => {
    let s = reducer(initialState, { type: 'new_live', key: 'k', cwd: '/w', folderId: null, title: 'N', resume: null });
    s = reducer(s, { type: 'server', message: { type: 'permission_request', key: 'k', requestId: 'r', toolName: 'Bash', input: {}, toolUseID: 't' } });
    s = reducer(s, { type: 'permission_answered', key: 'k' });
    expect(s.sessions.k.permission).toBeNull();
    s = reducer(s, { type: 'server', message: { type: 'error', key: 'k', message: 'boom' } });
    expect(s.sessions.k.error).toBe('boom');
    s = reducer(s, { type: 'local_prompt', key: 'k', text: 'again' });
    expect(s.sessions.k.error).toBeNull();
  });

  it('routes server events to the right session and clears the permission on result', () => {
    let s = reducer(initialState, { type: 'new_live', key: 'k', cwd: '/w', folderId: null, title: 'N', resume: null });
    s = reducer(s, { type: 'server', message: { type: 'started', key: 'k', sessionId: 'abc' } });
    expect(s.sessions.k.sessionId).toBe('abc');
    s = reducer(s, { type: 'server', message: { type: 'permission_request', key: 'k', requestId: 'r', toolName: 'Bash', input: {}, toolUseID: 't' } });
    expect(s.sessions.k.permission?.requestId).toBe('r');
    s = reducer(s, { type: 'server', message: { type: 'event', key: 'k', message: { type: 'result', is_error: false } } });
    expect(s.sessions.k.permission).toBeNull();
    expect(s.sessions.k.status).toBe('idle');
    expect(reducer(s, { type: 'server', message: { type: 'started', key: 'unknown', sessionId: 'x' } })).toBe(s);
  });
});
