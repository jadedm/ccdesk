// Native directory picker inside Tauri; null in a plain browser, where the typed field is
// the fallback.

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

export const hasNativeDialog = (): boolean => Boolean((window as TauriWindow).__TAURI_INTERNALS__);

export const pickDirectory = async (defaultPath?: string): Promise<string | null> => {
  if (!hasNativeDialog()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const chosen = await open({ directory: true, multiple: false, defaultPath });
  return typeof chosen === 'string' ? chosen : null;
};
