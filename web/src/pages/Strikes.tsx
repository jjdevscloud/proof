import { useState } from 'react';
import { useApi } from '../api.ts';
import type { StrikeRow } from '../api.ts';
import { fmtTokens, pct, tier } from '../format.ts';
import { MintSheet, SheetLegend } from '../components/MintSheet.tsx';
import { Bar, ErrorNote, Loading, StrikeCoin, Traits } from '../components/ui.tsx';

type Filter = 'all' | 'rare' | 'surviving';

export function Strikes() {
  const { data, error } = useApi<StrikeRow[]>('/strikes');
  const [filter, setFilter] = useState<Filter>('all');
  const [jump, setJump] = useState('');

  const rows = (data ?? []).filter((s) => (filter === 'rare' ? s.rank > 0 : filter === 'surviving' ? BigInt(s.surviving) > 0n : BigInt(s.issued) > 0n));
  const notable = [...rows].sort((a, b) => b.rank - a.rank || a.strike - b.strike).slice(0, 60);

  return (
    <>
      <div className="page-head">
        <h1>Strikes</h1>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (jump.trim()) location.hash = `#/strike/${Number(jump.replace('#', ''))}`;
          }}
        >
          <input placeholder="Go to strike #" value={jump} onChange={(e) => setJump(e.target.value)} inputMode="numeric" aria-label="Strike number" />
          <button className="btn btn-ghost">Go</button>
        </form>
      </div>

      <section className="panel">
        <div className="segmented" role="tablist">
          {(['all', 'rare', 'surviving'] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'rare' ? 'Rare only' : 'Still surviving'}
            </button>
          ))}
        </div>
        {error && <ErrorNote error={error} />}
        {data ? <MintSheet strikes={data} filter={filter} /> : <Loading />}
        <SheetLegend />
      </section>

      <section className="panel">
        <h2>{filter === 'rare' ? 'Rare strikes' : filter === 'surviving' ? 'Strikes with survivors' : 'Issued strikes'}</h2>
        {data && !notable.length && <p className="muted">Nothing here yet.</p>}
        <ul className="strike-list">
          {notable.map((s) => {
            const survivalPct = pct(s.surviving, s.issued);
            return (
              <li key={s.strike}>
                <StrikeCoin strike={s.strike} rank={s.rank} />
                <div className="strike-list-main">
                  <a href={`#/strike/${s.strike}`} className="strike-title">Strike #{s.strike}</a>
                  <Traits traits={s.traits} rank={s.rank} />
                </div>
                <div className="strike-list-bar">
                  <Bar value={survivalPct} tierClass={`t${tier(s.rank)}`} />
                  <span className="mono small muted">{fmtTokens(s.surviving)} surviving</span>
                </div>
              </li>
            );
          })}
        </ul>
        {rows.length > notable.length && <p className="muted small">Showing the {notable.length} rarest. Use the sheet above to open any strike.</p>}
      </section>
    </>
  );
}
