import type { SessionView } from '../state.ts';

type Props = {
  open: string[];
  sessions: Record<string, SessionView>;
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
};

const dotClass = (s: SessionView): string => (s.status === 'history' ? 'dot' : `dot ${s.status}`);

/** One tab per open session, in the order opened. The tree remains the other way to switch. */
export const Tabs = ({ open, sessions, activeKey, onActivate, onClose }: Props) => {
  if (open.length === 0) return null;
  return (
    <div className="tabs" role="tablist">
      {open.map((key) => {
        const s = sessions[key];
        if (!s) return null;
        const active = key === activeKey;
        return (
          <div key={key} role="tab" aria-selected={active} className={active ? 'tab active' : 'tab'} onClick={() => onActivate(key)} title={s.title}>
            <span className={dotClass(s)} />
            <span className="tab-title">{s.title}</span>
            <button className="tab-close" title="close" aria-label={`close ${s.title}`} onClick={(e) => { e.stopPropagation(); onClose(key); }}>×</button>
          </div>
        );
      })}
    </div>
  );
};
