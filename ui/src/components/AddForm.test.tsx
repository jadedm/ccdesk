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
    expect(html).toContain('>Name<');
    expect(html).toContain('>Directory<');
    expect(html).toContain('>Create<');
    expect(html).toContain('>Cancel<');
    // Labels are joined to their fields rather than living in a placeholder.
    expect(html).toMatch(/<label for="[^"]+-name">/);
    expect(html).toMatch(/<input id="[^"]+-name"/);
  });

  it('asks only for what each kind needs', () => {
    const folder = render('folder');
    expect(folder).toContain('Directory (optional)');
    const session = render('session');
    expect(session).toContain('Name (optional)');
    expect(session).not.toContain('>Directory');
    expect(session).toContain('Claude Code will title the session');
  });

  it('does not disable its submit button', () => {
    expect(render('workspace')).not.toContain('disabled');
  });
});
