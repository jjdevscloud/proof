import { useState } from 'react';
import { TIER_NAMES, tier } from '../format.ts';
import { PixelIcon, rollIconName, shareText, traitShare } from '../components/TraitIcons.tsx';
import { useApi } from '../api.ts';
import type { Stats } from '../api.ts';
import { odds } from '../components/Roll.tsx';
import { useConfig } from '../App.tsx';

// Every trait in one place: the rarity bands, the Strike traits and the rolled tiers. Display only; the roll table reads the committed rules from config.

// [trait, strikes, points, icon]
const DATES: [string, string, number, string][] = [
  ['Genesis', 'Strikes 0 to 4', 40, 'genesis'],
  ['Key Date', 'Strikes 5 to 24', 15, 'keydate'],
  ['Final Strike', 'Strike 793', 10, 'final'],
  ['Common Date', 'all others', 0, 'common'],
];
const ERRORS: [string, string, number, string][] = [
  ['Double Die', '3', 100, 'doubledie'],
  ['Wrong Planchet', '6', 70, 'wrongplanchet'],
  ['Off Center', '12', 50, 'offcenter'],
  ['Clipped Planchet', '24', 30, 'clipped'],
  ['Die Crack', '48', 15, 'diecrack'],
];

// The four bands, rarest last, with the points that put a Strike or a roll in each.
const BANDS: [number, string][] = [[0, '0 points'], [1, '1 to 29 points'], [2, '30 to 69 points'], [3, '70 points and up']];


export function Traits() {
  const config = useConfig();
  const [view, setView] = useState<'curve' | 'after'>('curve');
  // Each rarity's share of all Strikes, from the live counts by rank, as in the Strikes page key.
  const { data: stats } = useApi<Stats>('/stats');
  const byRank = stats?.byRank ?? [];
  const tierShare = (t: number) => shareText(byRank.filter((r) => tier(r.rank) === t).reduce((a, r) => a + r.strikes, 0), byRank.reduce((a, r) => a + r.strikes, 0));
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Traits</h1>
          <p className="muted page-sub">A trait is a label a Strike can carry, like Genesis or Double Die.</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head panel-head-stack">
          <h2>Rarity</h2>
          {/* DRAFT line, awaiting approval. */}
          <p className="muted list-sub">Points set the rarity. A Strike adds up its date and error points, and a roll takes the points of its tier.</p>
        </div>
        {/* Four square cards in a row, like the cards on Strikes and My wallet: picture top left, share top right. */}
        <ul className="strike-feature rarity-cards">
          {BANDS.map(([t, pts]) => (
            <li key={t} className={`t${t}`}>
              <header className="post-head strike-card-head">
                <span className="band-coin"><PixelIcon name="common" tight /></span>
                <span className="post-who">
                  <strong className="strike-title">{TIER_NAMES[t]}</strong>
                  <span className="small muted">{pts}</span>
                </span>
                {tierShare(t) && <span className="rarity-tag">{tierShare(t)} of Strikes</span>}
              </header>
            </li>
          ))}
        </ul>
      </section>

      {/* The two sets of traits as tabs on one panel, like the views on the Strikes page. */}
      <div className="tabs" role="tablist" aria-label="Traits">
        {(['curve', 'after'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'tab on' : 'tab'} onClick={() => setView(v)}>
            {v === 'curve' ? 'On the curve' : 'After the curve'}
          </button>
        ))}
      </div>
      <section className="panel tabbed">
        {view === 'curve' ? (
          <>
            <div className="view-head">
              <p className="muted view-line">On the curve means bought from the bonding curve during the sale. Those tokens get numbers, and every Strike has a date trait and may have one error.</p>
            </div>
            <table className="table traits-table">
              <thead>
                <tr><th>Kind</th><th>Symbol</th><th>Trait</th><th className="num">% of Strikes</th><th className="num">Strikes</th><th className="num">Points</th></tr>
              </thead>
              <tbody>
                {[...DATES.map((r) => ['Date', r] as const), ...ERRORS.map((r) => ['Error', r] as const)].map(([kind, [t, s, p, icon]]) => (
                  <TraitRow key={t} kind={kind} name={t} icon={icon} points={p} cells={[traitShare(t), s]} />
                ))}
              </tbody>
            </table>
          </>
        ) : (
          // The rolled tiers as a plain table like the Strike traits. The full live panel (counts, listings,
          // floors, latest rolls) is RollStats in Roll.tsx, kept for the Strikes page.
          <>
            <div className="view-head">
              {/* DRAFT line, awaiting approval. */}
              <p className="muted view-line">After the curve means bought once the curve has sold out, on any exchange. Those tokens are ordinary, and can be sealed and rolled for one of these tiers.</p>
            </div>
            {config.roll ? (
              <table className="table traits-table">
                <thead>
                  <tr><th>Kind</th><th>Symbol</th><th>Tier</th><th className="num">Chance per roll</th><th className="num">Rarity</th><th className="num">Points</th></tr>
                </thead>
                <tbody>
                  {[...config.roll.tiers, { ...config.roll.fallback, odds: 1_000_000 - config.roll.tiers.reduce((n, t) => n + t.odds, 0) }].map((t) => (
                    <TraitRow key={t.name} kind="Roll" name={t.name} icon={rollIconName(t.name)} points={t.points} cells={[odds(t.odds), TIER_NAMES[tier(t.points)]]} />
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">Rolling opens at launch.</p>}
          </>
        )}
      </section>

    </>
  );
}

function TraitRow({ kind, name, icon, points, cells }: { kind: string; name: string; icon: string | undefined; points: number; cells: string[] }) {
  const t = tier(points);
  return (
    <tr className="trait-row">
      <td>{kind}</td>
      <td className={`trait-icon t${t}`}>{icon && <PixelIcon name={icon} tight />}</td>
      <td><span className={`trait-name t${t}`}>{name}</span></td>
      {cells.map((c, i) => <td key={i} className="num">{c}</td>)}
      <td className="num">{points}</td>
    </tr>
  );
}
