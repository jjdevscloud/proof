import { useEffect } from 'react';

// Previous / next inside a pop-up, so you can move through a set without closing it. The arrow keys work too.
// It loops round at both ends.
export function StepNav({ at, total, onMove, label }: { at: number; total: number; onMove: (i: number) => void; label: string }) {
  const go = (d: number) => onMove((at + d + total) % total);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <nav className="trait-nav" aria-label={label}>
      <button type="button" onClick={() => go(-1)}>&larr; Previous</button>
      <span className="muted">{at + 1} of {total}</span>
      <button type="button" onClick={() => go(1)}>Next &rarr;</button>
    </nav>
  );
}
