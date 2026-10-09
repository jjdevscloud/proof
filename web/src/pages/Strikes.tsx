import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../api.ts';
import type { Stats, StrikeRow } from '../api.ts';
import { TIER_NAMES, fmtTokens, pct, tier } from '../format.ts';
import { MintSheet, SheetLegend } from '../components/MintSheet.tsx';
import type { KeyFocus } from '../components/MintSheet.tsx';
import { Bar, ErrorNote, Loading, StrikeCardView, StrikeCoin, Traits } from '../components/ui.tsx';
import { BitmapCurve, GradientView } from '../components/StrikesLab.tsx';
import { TraitIcon, shareText, traitShare } from '../components/TraitIcons.tsx';
import { FilterMenu } from '../components/FilterMenu.tsx';
import { SurvivalTable } from '../components/SurvivalTable.tsx';

type Filter = 'all' | 'rare' | 'surviving';
type Status = 'surviving' | 'melted' | 'unissued';

// DRAFT filter labels, awaiting approval.
const TRAIT_NAMES = ['Genesis', 'Key Date', 'Final Strike', 'Common Date', 'Double Die', 'Wrong Planchet', 'Off Center', 'Clipped Planchet', 'Die Crack'];
const STATUS_NAMES: [Status, string][] = [['surviving', 'Surviving'], ['melted', 'Fully melted'], ['unissued', 'Not yet issued']];

// One square size for both views, and one height for the graphic area.
const CELL = 10, GAP = 2;

export function Strikes() {
  const { data, error } = useApi<StrikeRow[]>('/strikes');
  const stats = useApi<Stats>('/stats');
  const s = stats.data;
  const filter = 'all' as Filter;
  // Each rarity's share of all Strikes, from the live counts by rank.
  const byRank = s?.byRank ?? [];
  const tierShare = (t: number) => shareText(byRank.filter((r) => tier(r.rank) === t).reduce((a, r) => a + r.strikes, 0), byRank.reduce((a, r) => a + r.strikes, 0));

  const [jump, setJump] = useState('');
  // Remember the chosen tab (this browser only), so a Strike's page can link back to the same view.
  type View = 'curve' | 'gradient' | 'sheet';
  const [view, setViewState] = useState<View>(() => {
    try {
      const v = sessionStorage.getItem('strikes-view');
      return v === 'sheet' || v === 'gradient' ? v : 'curve';
    } catch { return 'curve'; }
  });
  const setView = (v: View) => {
    setViewState(v);
    try { sessionStorage.setItem('strikes-view', v); } catch { /* private mode: just don't remember */ }
  };
  const [hovered, setHovered] = useState<KeyFocus>(null);
  const [pinned, setPinned] = useState<KeyFocus>(null);
  const focus = hovered ?? pinned;
  // The panel keeps the mint sheet's size on both tabs; the curve is drawn to fit that space.
  const vizRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, cell: 12, gap: 3 });
  useEffect(() => {
    const el = vizRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const c = el.querySelector('.cell'), sheet = el.querySelector('.sheet');
      setBox({
        w: el.clientWidth,
        h: el.clientHeight,
        cell: c ? c.getBoundingClientRect().width : 12,
        gap: sheet ? parseFloat(getComputedStyle(sheet).columnGap) || 3 : 3,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);
  const [tip, setTip] = useState<{ text: string; tier: string; x: number; y: number } | null>(null);
  const onHover = (e: React.MouseEvent) => {
    const el = (e.target as Element).closest('[data-tip]');
    setTip(el ? { text: el.getAttribute('data-tip')!, tier: el.getAttribute('data-tier') ?? '', x: e.clientX, y: e.clientY } : null);
  };

  // The list, ten to a page.
  const PER_PAGE = 10;
  const [page, setPage] = useState(0);
  const rows = (data ?? []).filter((s) => (filter === 'rare' ? s.rank > 0 : filter === 'surviving' ? BigInt(s.surviving) > 0n : BigInt(s.issued) > 0n));
  // Search: a Strike number, and filters by rarity, trait and status. Within a group any match counts,
  // across groups all must match. With nothing chosen the list shows the rarest Strikes.
  const [tiers, setTiers] = useState<number[]>([]);
  const [traits, setTraits] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const toggle = <T,>(list: T[], set: (v: T[]) => void, v: T) => { set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]); setPage(0); };
  const num = jump.replace(/[#,\s]/g, '');
  const searching = num !== '' || tiers.length > 0 || traits.length > 0 || statuses.length > 0;
  const statusOf = (s: StrikeRow): Status => (BigInt(s.issued) === 0n ? 'unissued' : BigInt(s.surviving) === 0n ? 'melted' : 'surviving');
  const found = (data ?? []).filter((s) =>
    (num === '' || String(s.strike).startsWith(num)) &&
    (!tiers.length || tiers.includes(tier(s.rank))) &&
    (!traits.length || (s.traits ?? []).some((t) => traits.includes(t))) &&
    (!statuses.length || statuses.includes(statusOf(s))));
  const notable = searching
    ? [...found].sort((a, b) => b.rank - a.rank || a.strike - b.strike)
    : [...rows].sort((a, b) => b.rank - a.rank || a.strike - b.strike).slice(0, 5);
  const clear = () => { setJump(''); setTiers([]); setTraits([]); setStatuses([]); setPage(0); };
  const pages = Math.max(1, Math.ceil(notable.length / PER_PAGE));
  const pageRows = notable.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const top5 = [...rows].sort((a, b) => b.rank - a.rank || a.strike - b.strike).slice(0, 5);

  return (
    <>
      {/* DRAFT lines, awaiting approval. */}
      <div className="page-head">
        <div>
          <h1>Strikes</h1>
          <p className="muted page-sub">On the curve. All 794 Strikes, their rarity, and how much of each survives, live from the chain.</p>
        </div>
        {/* The two headline numbers, in the same square as on the Rolls page. DRAFT labels. */}
        {data && (
          <div className="roll-stat-box">
            <div><strong>{data.filter((x) => BigInt(x.issued) > 0n).length.toLocaleString()}</strong><span className="muted">Strikes issued</span></div>
            <div><strong>{pct(data.reduce((a, x) => a + BigInt(x.surviving), 0n).toString(), data.reduce((a, x) => a + BigInt(x.issued), 0n).toString())}%</strong><span className="muted">Still surviving</span></div>
          </div>
        )}
      </div>


      {/* Find a Strike: a plain bar under the title. DRAFT wording, awaiting approval. */}
      <section className="strike-search top-search">
        <form
          className="search-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (num && found.length === 1) location.hash = `#/strike/${found[0].strike}`;
            else if (num) location.hash = `#/strike/${Number(num)}`;
          }}
        >
          <input placeholder="Search any of the 794 Strikes, #0 to #793" value={jump} onChange={(e) => { setJump(e.target.value); setPage(0); }} inputMode="numeric" aria-label="Strike number" />
          <FilterMenu label="Trait" options={TRAIT_NAMES.map((n) => ({ value: n, label: n, mark: <TraitIcon trait={n} />, note: traitShare(n), sep: n === 'Double Die', heading: n === 'Genesis' ? 'Date' : n === 'Double Die' ? 'Error' : undefined }))} chosen={traits} onToggle={(v) => toggle(traits, setTraits, v)} />
          <FilterMenu label="Rarity" options={[0, 1, 2, 3].map((t) => ({ value: t, label: TIER_NAMES[t], mark: <i className={`tier-dot t${t}`} />, note: tierShare(t) }))} chosen={tiers} onToggle={(v) => toggle(tiers, setTiers, v)} />
          <FilterMenu label="Status" options={STATUS_NAMES.map(([k, n]) => ({ value: k, label: n }))} chosen={statuses} onToggle={(v) => toggle(statuses, setStatuses, v)} />
          <button className="btn btn-primary">Search</button>
        </form>
        {searching && (
          <p className="search-summary">
            <span className="muted">{notable.length} {notable.length === 1 ? 'Strike' : 'Strikes'} match</span>
            <button type="button" className="chip-clear" onClick={clear}>Clear all</button>
          </p>
        )}
      </section>

      {searching && (
        <section className="panel">
          <div className="panel-head panel-head-stack">
            <h2>{notable.length} {notable.length === 1 ? 'Strike' : 'Strikes'} found</h2>
            <p className="muted list-sub">Matching your search, rarest first.</p>
          </div>
        {data && !notable.length && <p className="muted">{searching ? 'No Strikes match.' : 'Nothing here yet.'}</p>}
        {searching && (
          <ul className="strike-feature">
            {pageRows.map((s) => <li key={s.strike} className="card-link" onClick={() => openStrike(s.strike)}><StrikeCard s={s} /></li>)}
          </ul>
        )}
        {searching && pages > 1 && (
          <nav className="pager" aria-label="Pages">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous</button>
            <span className="pager-pages">
              {Array.from({ length: pages }, (_, i) => (
                <button key={i} type="button" className={i === page ? 'on' : ''} aria-current={i === page ? 'page' : undefined} onClick={() => setPage(i)}>{i + 1}</button>
              ))}
            </span>
            <button type="button" disabled={page === pages - 1} onClick={() => setPage(page + 1)}>Next →</button>
          </nav>
        )}
        </section>
      )}

      {/* The five rarest Strikes first, in a frame whose border cycles through the rarity colours. */}
      {!searching && data && top5.length > 0 && (
        <section className="feature-frame">
          <div className="feature-inner">
            {/* DRAFT heading and line, awaiting approval. */}
            <div className="panel-head panel-head-stack">
              <h2>The 5 rarest Strikes</h2>
              <p className="muted list-sub">The top of the ledger right now. The ones collectors want.</p>
            </div>
            <ul className="strike-feature">
              {top5.map((s) => (
                <li key={s.strike} className="card-link" onClick={() => openStrike(s.strike)}><StrikeCard s={s} /></li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <div className="tabs" role="tablist" aria-label="View">
        {(['curve', 'sheet', 'gradient'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'tab on' : 'tab'} onClick={() => setView(v)}>
            {v === 'sheet' ? 'Mint sheet' : v === 'gradient' ? 'Gradient' : 'On the curve'}
          </button>
        ))}
      </div>

      <section className="panel tabbed" data-focus={focus ?? undefined}>
        {/* DRAFT lines, awaiting approval. */}
        <div className="view-head">
        <p className="muted view-line">
          {view === 'sheet'
            ? 'Every Strike as one block, numbered 0 to 793. Colour is rarity.'
            : view === 'gradient'
              ? 'The same Strikes blended into one gradient, in buying order. Colour is rarity.'
              : 'The same Strikes along the bonding curve, in buying order. Each column is a few Strikes.'}
        </p>
        <SheetLegend shares={[0, 1, 2, 3].map(tierShare)} focus={focus} onFocus={setHovered} onPin={(f) => setPinned(pinned === f ? null : f)} />
        </div>
        {error && <ErrorNote error={error} />}
        <div
          className="viz"
          ref={vizRef}
          onMouseMove={onHover}
          onMouseLeave={() => setTip(null)}
          // One square size for both views; the sheet fills the full width, row after row from Strike 0.
          style={{ '--cols': box.w ? Math.floor((box.w + GAP) / (CELL + GAP)) : 100 } as React.CSSProperties}
        >
          {!data ? <Loading /> : (
            <>
              <div style={view !== 'sheet' ? { visibility: 'hidden' } : undefined}><MintSheet strikes={data} filter={filter} /></div>
              {view === 'curve' && box.w > 0 && <div className="curve-view"><BitmapCurve strikes={data} width={box.w} height={box.h} cell={CELL} gap={GAP} /></div>}
              {view === 'gradient' && <div className="curve-view"><GradientView strikes={data} focus={focus} /></div>}
            </>
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
          <h2>Survival by rarity</h2>
          {/* DRAFT line, awaiting approval. */}
          <p className="muted list-sub">How much of each rarity is still rare. Rare tokens melt when they are sold or sent, so these numbers can only go down.</p>
        </div>
        {!s ? <Loading /> : !s.revealed ? (
          <p className="muted">Traits are sealed until the reveal. Until then every Strike counts as equal, and the highest-numbered tokens leave a wallet first.</p>
        ) : (
          <SurvivalTable rows={s.byRank} />
        )}
      </section>


    </>
  );
}


// One Strike as a card: the shared Strike card, with how much survives as its grey line.
function StrikeCard({ s }: { s: StrikeRow }) {
  return <StrikeCardView strike={s.strike} rank={s.rank} traits={s.traits} part={s.surviving} whole={s.issued} sub={BigInt(s.issued) === 0n ? 'Not yet bought' : `${pct(s.surviving, s.issued)}% surviving`} />;
}

// The whole card opens the Strike, not only its picture or title (links inside still work as before).
function openStrike(strike: number) {
  location.hash = `#/strike/${strike}`;
}
