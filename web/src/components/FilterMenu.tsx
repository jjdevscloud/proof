import type { ReactNode } from 'react';
import { Fragment, useEffect, useRef, useState } from 'react';

// A drop down filter: a button showing how many options are chosen, opening a list of tick boxes.
export function FilterMenu<T extends string | number>({ label, options, chosen, onToggle }: { label: string; options: { value: T; label: string; mark?: ReactNode; note?: string; sep?: boolean; heading?: string }[]; chosen: T[]; onToggle: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="filter-menu" ref={ref}>
      <button type="button" className={chosen.length ? 'filter-btn on' : 'filter-btn'} aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}{chosen.length > 0 && <span className="filter-count">{chosen.length}</span>}
        <svg className="filter-caret" viewBox="0 0 10 6" aria-hidden><path d="M1 1l4 4 4-4" /></svg>
      </button>
      {open && (
        <div className="filter-list" role="menu">
          {options.map((o) => (
            <Fragment key={String(o.value)}>
            {o.heading && <span className={o.sep ? 'filter-heading filter-sep' : 'filter-heading'}>{o.heading}</span>}
            <label className={o.sep && !o.heading ? 'filter-option filter-sep' : 'filter-option'}>
              <input type="checkbox" checked={chosen.includes(o.value)} onChange={() => onToggle(o.value)} />
              {o.mark}{o.label}
              {o.note && <span className="filter-note">{o.note}</span>}
            </label>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
