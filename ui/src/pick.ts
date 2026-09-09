// Native directory picker inside Tauri; null in a plain browser, where the typed field is
// the fallback.

import { insideTauri } from './api.ts';

export const hasNativeDialog = (): boolean => insideTauri();

export const pickDirectory = async (defaultPath?: string): Promise<string | null> => {
  if (!hasNativeDialog()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const chosen = await open({ directory: true, multiple: false, defaultPath });
  return typeof chosen === 'string' ? chosen : null;
};
