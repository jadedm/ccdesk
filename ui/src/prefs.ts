// Per-machine reading preferences. localStorage can be missing or throw (private windows,
// blocked storage), so every access is guarded and the defaults always apply.

export type Prefs = { railWidth: number; textSize: number; bionic: boolean; hideThinking: boolean };

export const defaults: Prefs = { railWidth: 280, textSize: 17, bionic: false, hideThinking: true };

export const railBounds = { min: 200, max: 600 };
export const textBounds = { min: 13, max: 26 };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const loadPrefs = (): Prefs => {
  try {
    const raw = localStorage.getItem('ccdesk.prefs');
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      railWidth: clamp(Number(parsed.railWidth ?? defaults.railWidth), railBounds.min, railBounds.max),
      textSize: clamp(Number(parsed.textSize ?? defaults.textSize), textBounds.min, textBounds.max),
      bionic: Boolean(parsed.bionic ?? defaults.bionic),
      hideThinking: Boolean(parsed.hideThinking ?? defaults.hideThinking),
    };
  } catch {
    return defaults;
  }
};

export const savePrefs = (prefs: Prefs): void => {
  try {
    localStorage.setItem('ccdesk.prefs', JSON.stringify(prefs));
  } catch {
    // storage unavailable; the session keeps its in-memory value
  }
};

export const clampRail = (width: number): number => clamp(width, railBounds.min, railBounds.max);
export const clampText = (size: number): number => clamp(size, textBounds.min, textBounds.max);
