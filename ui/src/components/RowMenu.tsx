import { useEffect, useRef, useState } from 'react';

export type MenuAction = { label: string; onPick: () => void; danger?: boolean };

/** A "…" button that opens a list of actions. The list is positioned fixed against the
 * trigger's box, because the rail and each row clip their overflow and an absolutely
 * positioned popup inside them is cut off. Focus moves into the list and returns to the
 * trigger on Escape. */
export const RowMenu = ({ actions, label }: { actions: MenuAction[]; label: string }) => {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const close = (restoreFocus: boolean) => {
    setAt(null);
    if (restoreFocus) trigger.current?.focus();
  };

  const open = () => {
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    setAt({ top: Math.round(box.bottom + 2), right: Math.round(window.innerWidth - box.right) });
  };

  useEffect(() => {
    if (!at) return;
    list.current?.querySelector('button')?.focus();
    const away = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close(true);
    const reposition = () => close(false);
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [at]);

  if (actions.length === 0) return null;
  return (
    <span className="rowmenu" onClick={(e) => e.stopPropagation()}>
      <button ref={trigger} type="button" className="mini" aria-label={label} aria-haspopup="true" aria-expanded={at !== null} onClick={() => (at ? close(false) : open())}>…</button>
      {at && (
        <div ref={list} className="rowmenu-list" style={{ top: at.top, right: at.right }}>
          {actions.map((a) => (
            <button type="button" key={a.label} className={a.danger ? 'menuitem danger' : 'menuitem'} onClick={() => { close(false); a.onPick(); }}>{a.label}</button>
          ))}
        </div>
      )}
    </span>
  );
};
