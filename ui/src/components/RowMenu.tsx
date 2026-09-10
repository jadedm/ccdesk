import { useEffect, useRef, useState } from 'react';

export type MenuAction = { label: string; onPick: () => void; danger?: boolean };

/** A small "…" button that opens a list of actions; closes on pick, Escape or an outside click. */
export const RowMenu = ({ actions, label }: { actions: MenuAction[]; label: string }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  if (actions.length === 0) return null;
  return (
    <span className="rowmenu" ref={box} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="mini" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>…</button>
      {open && (
        <ul role="menu" className="rowmenu-list">
          {actions.map((a) => (
            <li key={a.label} role="menuitem">
              <button type="button" className={a.danger ? 'menuitem danger' : 'menuitem'} onClick={() => { setOpen(false); a.onPick(); }}>{a.label}</button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
};
