import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { useApi } from '../api.ts';
import type { Stats, StrikeRow } from '../api.ts';
import { TIER_NAMES, fmtTokens, pct, tier } from '../format.ts';
import { CurveView, GradientView, MintSheet, SheetLegend } from '../components/MintSheet.tsx';
import type { Focus } from '../components/MintSheet.tsx';
import { Bar, ErrorNote, Loading, StrikeCoin, Traits } from '../components/ui.tsx';

type View = 'curve' | 'sheet' | 'gradient';
const CURVE_CELL = 10;
const CURVE_GAP = 2;
const PAGE = 10;

export function Strikes() {
  const { data, error } = useApi<StrikeRow[]>('/strikes');
  const stats = useApi<Stats>('/stats').data;
  const [jump, setJump] = useState('');
  const [view, setViewState] = useState<View>(() => {
    try {
      const v = sessionStorage.getItem('strikes-view');
      return v === 'sheet' || v === 'gradient' ? v : 'curve';
    } catch {
      return 'curve';
    }
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      sessionStorage.setItem('strikes-view', v);
    } catch {}
  };
  const [hoverFocus, setHoverFocus] = useState<Focus | null>(null);
  const [pinned, setPinned] = useState<Focus | null>(null);
  const focus = hoverFocus ?? pinned;

  const vizRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, cell: 12, gap: 3 });
  useEffect(() => {
    const el = vizRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cell = el.querySelector('.cell');
      const sheet = el.querySelector('.sheet');
      setBox({
        w: el.clientWidth,
        h: el.clientHeight,
        cell: cell ? cell.getBoundingClientRect().width : 12,
        gap: (sheet && parseFloat(getComputedStyle(sheet).columnGap)) || 3,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const [tip, setTip] = useState<{ text: string; tier: string; x: number; y: number } | null>(null);
  const onMove = (e: MouseEvent) => {
    const el = (e.target as Element).closest('[data-tip]');
    setTip(el ? { text: el.getAttribute('data-tip')!, tier: el.getAttribute('data-tier') ?? '', x: e.clientX, y: e.clientY } : null);
  };

  const rarest = [...(data ?? []).filter((s) => BigInt(s.issued) > 0n)].sort((a, b) => b.rank - a.rank || a.strike - b.strike).slice(0, 60);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rarest.length / PAGE));
  const shown = rarest.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Strikes</h1>
          <p className="muted page-sub">The live $PROOF ledger, showing all 794 Strikes, their rarity, and how much of each survives, read from the chain by the indexer.</p>
        </div>
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

      <div className="tabs" role="tablist" aria-label="View">
        {(['curve', 'sheet', 'gradient'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'tab on' : 'tab'} onClick={() => setView(v)}>
            {v === 'gradient' ? (
              <svg className="tab-icon tab-icon-gradient" viewBox="0 0 13 9" aria-hidden shapeRendering="crispEdges">
                {[0, 1, 2, 3].map((i) => <rect key={i} className={`gi${i}`} x={i * 3.4} y={0} width={2.6} height={9} />)}
              </svg>
            ) : v === 'sheet' ? (
              <svg className="tab-icon" viewBox="0 0 13 9" aria-hidden shapeRendering="crispEdges">
                {[0, 1, 2, 3].flatMap((x) => [0, 1, 2].map((y) => <rect key={`${x},${y}`} x={x * 3.4} y={y * 3.2} width={2.6} height={2.4} />))}
              </svg>
            ) : (
              <svg className="tab-icon" viewBox="0 0 13 9" aria-hidden shapeRendering="crispEdges">
                {[1.6, 2.6, 4, 6, 9].map((h, i) => <rect key={i} x={i * 2.7} y={9 - h} width={2} height={h} />)}
              </svg>
            )}
            {v === 'sheet' ? 'Mint sheet' : v === 'gradient' ? 'Gradient' : 'Bonding curve'}
          </button>
        ))}
      </div>

      <section className="panel tabbed" data-focus={focus ?? undefined}>
        <div className="view-head">
          <p className="muted view-line">
            {view === 'sheet'
              ? 'Every Strike as one block, numbered 0 to 793. Colour is rarity.'
              : view === 'gradient'
                ? 'The same Strikes blended into one gradient, in buying order. Colour is rarity.'
                : 'The same Strikes along the bonding curve, in buying order. Each column is a few Strikes.'}
          </p>
          <SheetLegend focus={focus} onFocus={setHoverFocus} onPin={(f) => setPinned(pinned === f ? null : f)} />
        </div>
        {error && <ErrorNote error={error} />}
        <div
          className="viz"
          ref={vizRef}
          onMouseMove={onMove}
          onMouseLeave={() => setTip(null)}
          style={{ '--cols': box.w ? Math.floor((box.w + CURVE_GAP) / 12) : 100 } as CSSProperties}
        >
          {data ? (
            <>
              <div style={view === 'sheet' ? undefined : { visibility: 'hidden' }}>
                <MintSheet strikes={data} filter="all" />
              </div>
              {view === 'curve' && box.w > 0 && (
                <div className="curve-view">
                  <CurveView strikes={data} width={box.w} height={box.h} cell={CURVE_CELL} gap={CURVE_GAP} />
                </div>
              )}
              {view === 'gradient' && (
                <div className="curve-view">
                  <GradientView strikes={data} focus={focus} />
                </div>
              )}
            </>
          ) : (
            <Loading />
          )}
        </div>
        {tip && (
          <div className="hover-tip" style={{ left: tip.x + 14, top: tip.y + 14 }} aria-hidden>
            <i className={`tip-swatch tip-${tip.tier}`} />
            <span className="tip-body">
              <strong>{tip.text.split('|')[0]}</strong>
              <span>{tip.text.split('|')[1]}</span>
            </span>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head panel-head-stack">
          <h2>The {rarest.length} rarest Strikes</h2>
          <p className="muted list-sub">Ranked by rarity. Open any other Strike from the map above.</p>
        </div>
        {data && !rarest.length && <p className="muted">Nothing here yet.</p>}
        <ul className="strike-list">
          {shown.map((s) => {
            const survivalPct = pct(s.surviving, s.issued);
            return (
              <li key={s.strike}>
                <StrikeCoin strike={s.strike} rank={s.rank} part={s.surviving} whole={s.issued} />
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
        {pages > 1 && (
          <nav className="pager" aria-label="Pages">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous</button>
            <span className="pager-pages">
              {Array.from({ length: pages }, (_, i) => (
                <button key={i} type="button" className={i === page ? 'on' : ''} aria-current={i === page ? 'page' : undefined} onClick={() => setPage(i)}>
                  {i + 1}
                </button>
              ))}
            </span>
            <button type="button" disabled={page === pages - 1} onClick={() => setPage(page + 1)}>Next →</button>
          </nav>
        )}
      </section>

      <section className="panel">
        <h2>Survival by rarity</h2>
        {!stats ? <Loading /> : !stats.revealed ? (
          <p className="muted">Traits are sealed until the reveal. Until then every Strike counts as equal, and the highest-numbered tokens leave a wallet first.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Rarity</th><th className="num">Strikes</th><th>Surviving</th></tr>
            </thead>
            <tbody>
              {stats.byRank.map((r) => (
                <tr key={r.rank}>
                  <td><span className={`tier-dot t${tier(r.rank)}`} />{TIER_NAMES[tier(r.rank)]} <span className="muted small">rank {r.rank}</span></td>
                  <td className="num mono">{r.strikes}</td>
                  <td>
                    <div className="bar-row">
                      <Bar value={pct(r.surviving, r.issued)} tierClass={`t${tier(r.rank)}`} />
                      <span className="mono small">{BigInt(r.issued) === 0n ? '—' : `${pct(r.surviving, r.issued)}%`}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
