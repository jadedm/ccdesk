import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AddForm } from './AddForm.tsx';

const render = (kind: 'workspace' | 'folder' | 'session') =>
  renderToStaticMarkup(<AddForm kind={kind} onSubmit={() => {}} onCancel={() => {}} />);

describe('AddForm', () => {
  it('labels its fields, explains itself, and always offers a way out', () => {
    const html = render('workspace');
    expect(html).toContain('New workspace');
    expect(html).toContain('A workspace is a directory on disk');
    expect(html).toContain('Name (optional)');
    expect(html).toContain('>Directory<');
    // The directory comes first: it is the real decision and it supplies the name.
    expect(html.indexOf('Directory')).toBeLessThan(html.indexOf('Name (optional)'));
    expect(html).toContain('>Create<');
    expect(html).toContain('>Cancel<');
    // Labels are joined to their fields rather than living in a placeholder.
    expect(html).toMatch(/<label for="[^"]+-name">/);
    expect(html).toMatch(/<input id="[^"]+-name"/);
    // Outside the app a browser cannot return a real path, and the form says so.
    expect(html).toContain('desktop app opens a folder picker');
  });

  it('asks only for what each kind needs', () => {
    const folder = render('folder');
    expect(folder).toContain('Directory (optional)');
    const session = render('session');
    expect(session).toContain('Name (optional)');
    expect(session).not.toContain('>Directory');
    expect(session).toContain('Claude Code will title the session');
  });

  it('offers a Create button that is never disabled, since the form says why instead', () => {
    const html = render('workspace');
    expect(html).toMatch(/<button type="submit"[^>]*>Create<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled/);
  });
});
