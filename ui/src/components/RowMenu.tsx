import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

export type MenuAction = { label: string; onPick: () => void; danger?: boolean };

/** A "…" button that opens a list of actions. The list is positioned fixed against the
 * trigger's box, because the rail and each row clip their overflow and an absolutely
 * positioned popup inside them is cut off. Focus moves into the list and returns to the
 * trigger on Escape. */
export type RowMenuHandle = { openAt: (x: number, y: number) => void };

export const RowMenu = forwardRef<RowMenuHandle, { actions: MenuAction[]; label: string }>(({ actions, label }, handle) => {
  const [at, setAt] = useState<{ top: number; right: number; above: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const close = (restoreFocus: boolean) => {
    setAt(null);
    if (restoreFocus) trigger.current?.focus();
  };

  /** Below the trigger, or above it when the list would fall off the bottom. */
  const place = useCallback(() => {
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return null;
    const height = 12 + actions.length * 27;
    const above = box.bottom + height > window.innerHeight;
    return {
      top: Math.round(above ? Math.max(4, box.top - height) : box.bottom + 2),
      right: Math.round(window.innerWidth - box.right),
      above,
    };
  }, [actions.length]);

  const isOpen = at !== null;
  useEffect(() => {
    if (!isOpen) return;
    list.current?.querySelector('button')?.focus();
    const away = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close(true);
    // Scrolling follows the row rather than dismissing: focusing the trigger can itself
    // scroll a partly visible row into view, which would otherwise close the menu at once.
    const follow = () => {
      const next = place();
      if (next) setAt(next);
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [isOpen, place]);

  // A right-click anywhere on the row opens the same list where the pointer is.
  useImperativeHandle(handle, () => ({
    openAt: (x: number, y: number) => {
      const height = 12 + actions.length * 27;
      setAt({ top: Math.round(Math.min(y, Math.max(4, window.innerHeight - height - 4))), right: Math.round(Math.max(4, window.innerWidth - x)), above: false });
    },
  }), [actions.length]);

  if (actions.length === 0) return null;
  return (
    <span className="rowmenu" onClick={(e) => e.stopPropagation()}>
      <button ref={trigger} type="button" className="mini" aria-label={label} aria-haspopup="true" aria-expanded={at !== null} onClick={() => setAt(at ? null : place())}>…</button>
      {at && (
        <div ref={list} className="rowmenu-list" style={{ top: at.top, right: at.right }}>
          {actions.map((a) => (
            <button type="button" key={a.label} className={a.danger ? 'menuitem danger' : 'menuitem'} onClick={() => { close(false); a.onPick(); }}>{a.label}</button>
          ))}
        </div>
      )}
    </span>
  );
});

RowMenu.displayName = 'RowMenu';
