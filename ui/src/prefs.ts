// Per-machine reading preferences. localStorage can be missing or throw (private windows,
// blocked storage), so every access is guarded and the defaults always apply.

export type Theme = 'light' | 'dark';

export type Prefs = {
  railWidth: number;
  textSize: number;
  bionic: boolean;
  hideThinking: boolean;
  showTools: boolean;
  showSystem: boolean;
  theme: Theme;
  railCollapsed: boolean;
};

export const defaults: Prefs = { railWidth: 280, textSize: 16.5, bionic: false, hideThinking: true, showTools: true, showSystem: false, theme: 'light', railCollapsed: false };

export const railBounds = { min: 200, max: 600 };
export const textBounds = { min: 13, max: 26 };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Stored values may be anything; only a finite number is used, otherwise the default. */
const numberOr = (value: unknown, fallback: number): number => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : fallback);

export const loadPrefs = (): Prefs => {
  try {
    const raw = localStorage.getItem('ccdesk.prefs');
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      railWidth: clamp(numberOr(parsed.railWidth, defaults.railWidth), railBounds.min, railBounds.max),
      textSize: clamp(numberOr(parsed.textSize, defaults.textSize), textBounds.min, textBounds.max),
      bionic: Boolean(parsed.bionic ?? defaults.bionic),
      hideThinking: Boolean(parsed.hideThinking ?? defaults.hideThinking),
      showTools: Boolean(parsed.showTools ?? defaults.showTools),
      showSystem: Boolean(parsed.showSystem ?? defaults.showSystem),
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      railCollapsed: parsed.railCollapsed === true,
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

/** The app grid's columns: rail, splitter and main, or main alone when the rail is collapsed. */
export const gridColumns = (collapsed: boolean, railWidth: number): string => (collapsed ? '0 0 1fr' : `${railWidth}px 6px 1fr`);
