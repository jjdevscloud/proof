import { useEffect, useState } from 'react';
import { Modal } from './ui.tsx';
import { useStepReveal } from './useStepReveal.ts';
import { PixelIcon, traitShare } from './TraitIcons.tsx';

// The traits table from the white paper (section 9.1), set as free text with no frame.
// Each trait has a tiny pixel icon in its rarity colour: date traits show a Strike's place in the row,
// errors show the minting fault on a block coin.

// [trait, strikes, points, icon, tier]
const DATES: [string, string, number, string, number][] = [
  ['Genesis', 'Strikes 0 to 4', 40, 'genesis', 2],
  ['Key Date', 'Strikes 5 to 24', 15, 'keydate', 1],
  ['Final Strike', 'Strike 793', 10, 'final', 1],
  ['Common Date', 'all others', 0, 'common', 0],
];
const ERRORS: [string, string, number, string, number][] = [
  ['Double Die', '3', 100, 'doubledie', 3],
  ['Wrong Planchet', '6', 70, 'wrongplanchet', 3],
  ['Off Center', '12', 50, 'offcenter', 2],
  ['Clipped Planchet', '24', 30, 'clipped', 2],
  ['Die Crack', '48', 15, 'diecrack', 1],
];

type TraitRow = [string, string, number, string, number];

function Row({ kind, row: [t, s, p, icon, tier], on, onOpen }: { kind: string; row: TraitRow; on: boolean; onOpen: () => void }) {
  return (
    <tr className={on ? 'step in trait-row' : 'step trait-row'} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()} tabIndex={0} aria-label={`Open ${t}`}>
      <td>{kind}</td>
      <td className={`trait-icon t${tier}`}><PixelIcon name={icon} tight /></td>
      <td><span className={`trait-name t${tier}`}>{t}</span></td>
      <td className="num">{traitShare(t)}</td>
      <td className="num">{s}</td>
      <td className="num">{p}</td>
    </tr>
  );
}

// Every trait in table order, so the pop-up can step through them.
const ALL: [string, TraitRow][] = [...DATES.map((r) => ['Date', r] as [string, TraitRow]), ...ERRORS.map((r) => ['Error', r] as [string, TraitRow])];

// The trait's icon large, with its row from the table, and arrows to move to the next or previous trait.
function TraitModal({ at, onMove, onClose }: { at: number; onMove: (i: number) => void; onClose: () => void }) {
  const [kind, [t, s, p, icon, tier]] = ALL[at];
  const go = (d: number) => onMove((at + d + ALL.length) % ALL.length);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Modal title={t} onClose={onClose}>
      <div className="trait-modal">
        <div className={`trait-big t${tier}`}><PixelIcon name={icon} /></div>
        <dl className="trait-facts">
          <dt>Kind</dt><dd>{kind}</dd>
          <dt>Strikes</dt><dd>{s}</dd>
          <dt>Points</dt><dd>{p}</dd>
        </dl>
        <nav className="trait-nav" aria-label="Traits">
          <button type="button" onClick={() => go(-1)}>&larr; Previous</button>
          <span className="muted">{at + 1} of {ALL.length}</span>
          <button type="button" onClick={() => go(1)}>Next &rarr;</button>
        </nav>
      </div>
    </Modal>
  );
}

export function TraitsTable() {
  const rows = DATES.length + ERRORS.length;
  const { ref, shown, pinned } = useStepReveal(rows);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="traits-scroll" ref={ref} style={pinned ? { height: `${100 + rows * 16}vh` } : undefined}>
    <div className={pinned ? 'traits-stage' : undefined}>
    <div className="traits-free">
      <h2>Traits</h2>
      <p>
        Every Strike has a date trait and may have one error. Date traits are positional and visible from the moment a
        Strike is sold. Errors are random, named after real minting errors, and assigned at the reveal.
      </p>
      <button type="button" className="traits-expand" onClick={() => setOpen(0)} aria-label="Open the trait symbols">
        <svg viewBox="0 0 14 14" aria-hidden><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" /></svg>
      </button>
      <table className="table">
        <thead>
          <tr><th>Kind</th><th>Symbol</th><th>Trait</th><th className="num">% of Strikes</th><th className="num">Strikes</th><th className="num">Points</th></tr>
        </thead>
        <tbody>
          {DATES.map((r, i) => <Row key={r[0]} kind="Date" row={r} on={i < shown} onOpen={() => setOpen(i)} />)}
        </tbody>
        <tbody className="group">
          {ERRORS.map((r, i) => <Row key={r[0]} kind="Error" row={r} on={DATES.length + i < shown} onOpen={() => setOpen(DATES.length + i)} />)}
        </tbody>
      </table>
    </div>
    </div>
    {open !== null && <TraitModal at={open} onMove={setOpen} onClose={() => setOpen(null)} />}
    </section>
  );
}
