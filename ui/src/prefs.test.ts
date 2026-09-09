import { beforeEach, describe, expect, it } from 'vitest';
import { clampRail, clampText, defaults, loadPrefs, savePrefs } from './prefs.ts';

describe('preferences', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips and clamps stored values', () => {
    savePrefs({ railWidth: 900, textSize: 5, bionic: true, hideThinking: false });
    expect(loadPrefs()).toEqual({ railWidth: 600, textSize: 13, bionic: true, hideThinking: false });
    expect(clampRail(10)).toBe(200);
    expect(clampText(99)).toBe(26);
  });

  it('falls back to defaults on junk, so no NaN reaches the layout', () => {
    localStorage.setItem('ccdesk.prefs', JSON.stringify({ railWidth: 'abc', textSize: null, bionic: 'yes' }));
    expect(loadPrefs()).toEqual({ ...defaults, bionic: true });
    localStorage.setItem('ccdesk.prefs', '{not json');
    expect(loadPrefs()).toEqual(defaults);
  });
});
