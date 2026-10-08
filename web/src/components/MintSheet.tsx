import type { CSSProperties, ReactNode } from 'react';
import type { StrikeRow } from '../api.ts';
import { TIER_NAMES, fmtTokens, tier } from '../format.ts';

// The three views of all 794 Strikes on the Strikes page. Cells carry `data-tip` / `data-tier`,
// which the page turns into a hover tooltip.

// Every strike as one cell: colour = rarity tier, outlined = not yet bought off the curve.
export function MintSheet({ strikes, filter = 'all' }: { strikes: StrikeRow[]; filter?: 'all' | 'rare' | 'surviving' }) {
  return (
    <div className="sheet" role="list">
      {strikes.map((s) => {
        const issued = BigInt(s.issued);
        const surviving = BigInt(s.surviving);
        const frac = issued === 0n ? 0 : Number((surviving * 1000n) / issued) / 1000;
        const dim = (filter === 'rare' && s.rank === 0) || (filter === 'surviving' && surviving === 0n);
        const state = issued === 0n ? 'unissued' : surviving === 0n ? 'melted' : 'live';
        const detail = `${TIER_NAMES[tier(s.rank)]}${s.traits ? ` · ${s.traits.join(', ')}` : ''} · ${
          issued === 0n ? 'not yet issued' : `${fmtTokens(s.surviving)} of ${fmtTokens(s.issued)} surviving`}`;
        return (
          <a
            key={s.strike}
            role="listitem"
            href={`#/strike/${s.strike}`}
            className={`cell t${tier(s.rank)} ${state}${dim ? ' dim' : ''}`}
            style={{ '--f': frac } as CSSProperties}
            aria-label={`Strike #${s.strike} · ${detail}`}
            data-tip={`Strike #${s.strike}|${detail}`}
            data-tier={issued === 0n ? 'u' : surviving === 0n ? 'm' : tier(s.rank)}
          />
        );
      })}
    </div>
  );
}

export type Focus = 't0' | 't1' | 't2' | 't3' | 'melted' | 'unissued';

// The colour key. With handlers it doubles as a filter: hover to preview, click to pin.
export function SheetLegend({ focus = null, onFocus, onPin }: {
  focus?: Focus | null;
  onFocus?: (f: Focus | null) => void;
  onPin?: (f: Focus) => void;
} = {}) {
  const item = (key: Focus, swatch: string, label: ReactNode) => (
    <button
      key={key}
      type="button"
      className={focus === key ? 'key-item on' : 'key-item'}
      onMouseEnter={() => onFocus?.(key)}
      onMouseLeave={() => onFocus?.(null)}
      onFocus={() => onFocus?.(key)}
      onBlur={() => onFocus?.(null)}
      onClick={() => onPin?.(key)}
      aria-pressed={focus === key}
    >
      <i className={`swatch ${swatch}`} />{label}
    </button>
  );
  return (
    <div className={onFocus ? 'legend small key-interactive' : 'legend small'}>
      {onFocus && <span className="key-hint">Filter</span>}
      {TIER_NAMES.map((n, i) => item(`t${i}` as Focus, `t${i}`, n))}
      {item('melted', 'melted-swatch', 'Melted')}
      {item('unissued', 'unissued-swatch', 'Not yet issued')}
    </div>
  );
}

const survivingShare = (s: StrikeRow) => (BigInt(s.issued) === 0n ? 0 : Number((BigInt(s.surviving) * 1000n) / BigInt(s.issued)) / 1000);
const isIssued = (s: StrikeRow) => BigInt(s.issued) > 0n;
const STATE_NAMES: Record<Focus, string> = {
  t3: 'Legendary',
  t2: 'Rare',
  t1: 'Uncommon',
  t0: 'Common',
  melted: 'Melted',
  unissued: 'not yet issued',
};

function stateOf(s: StrikeRow): Focus {
  if (!isIssued(s)) return 'unissued';
  return BigInt(s.surviving) === 0n ? 'melted' : `t${tier(s.rank)}`;
}

// Tooltip for a group of Strikes: their range and how many are in each state.
function groupTip(group: StrikeRow[]) {
  const counts: Partial<Record<Focus, number>> = {};
  group.forEach((s) => (counts[stateOf(s)] = (counts[stateOf(s)] ?? 0) + 1));
  const present = (['t3', 't2', 't1', 't0', 'melted', 'unissued'] as Focus[]).filter((k) => counts[k]);
  const lead = present.find((k) => k.startsWith('t')) ?? present[0] ?? 'unissued';
  const first = group[0]?.strike ?? 0;
  return {
    tip: `Strikes #${first} to #${group[group.length - 1]?.strike ?? first}|${present.map((k) => `${counts[k]} ${STATE_NAMES[k]}`).join(', ')}`,
    tier: lead.startsWith('t') ? lead.slice(1) : lead === 'melted' ? 'm' : 'u',
  };
}

// Strikes along the bonding curve: columns of cells that grow with buying order, coloured by the
// surviving share of each tier in that column.
export function CurveView({ strikes, width = 1200, height = 440, cell = 7, gap = 2 }: {
  strikes: StrikeRow[];
  width?: number;
  height?: number;
  cell?: number;
  gap?: number;
}) {
  const W = Math.max(300, Math.round(width));
  const H = Math.max(120, Math.round(height));
  const base = H - 26;
  const size = cell;
  const pitch = cell + gap;
  const headroom = Math.ceil(pitch * 1.4) + 12;
  const columns = Math.floor((W - 0) / pitch);
  const maxRows = Math.floor((base - headroom) / pitch);
  const perColumn = (strikes.length || 794) / columns;
  const rects: ReactNode[] = [];
  for (let c = 0; c < columns; c++) {
    const group = strikes.slice(Math.floor(c * perColumn), Math.floor((c + 1) * perColumn));
    const rows = Math.max(1, Math.round(maxRows * (c / (columns - 1)) ** 2.4) + 1);
    const x = 0 + c * pitch;
    const issued = group.filter(isIssued);
    const share = [0, 0, 0, 0];
    issued.forEach((s) => (share[tier(s.rank)] += survivingShare(s)));
    const fills: number[] = [];
    if (issued.length) {
      const scale = rows / group.length;
      const counts = [0, 1, 2, 3].map((t) => (t > 0 && share[t] > 0 ? Math.max(1, Math.round(share[t] * scale)) : Math.round(share[t] * scale)));
      let over = counts.reduce((a, b) => a + b, 0) - rows;
      for (let t = 0; t < 4 && over > 0; t++) {
        const cut = Math.min(over, t === 0 ? counts[0] : Math.max(0, counts[t] - 1));
        counts[t] -= cut;
        over -= cut;
      }
      [0, 1, 2, 3].forEach((t) => {
        for (let i = 0; i < counts[t]; i++) fills.push(t);
      });
    }
    const { tip } = groupTip(group);
    for (let r = 0; r < rows; r++) {
      const y = base - (r + 1) * pitch;
      const t = fills[r];
      rects.push(t === undefined
        ? <rect key={`${c},${r}`} className={issued.length ? 'lab-gone' : 'lab-future'} x={x} y={y} width={size} height={size} data-tip={tip} data-tier={issued.length ? 'm' : 'u'} />
        : <rect key={`${c},${r}`} className={`lab-t${t}`} x={x} y={y} width={size} height={size} data-tip={tip} data-tier={t} />);
    }
  }
  const lift = pitch * 1.4;
  const curveY = (c: number) => base - (maxRows * (c / (columns - 1)) ** 2.4 + 1) * pitch - lift;
  const path = Array.from({ length: 61 }, (_, i) => {
    const c = (i / 60) * (columns - 1);
    return `${i ? 'L' : 'M'}${(0 + c * pitch + size / 2).toFixed(1)} ${curveY(c).toFixed(1)}`;
  }).join(' ');
  const tipX = 0 + (columns - 1) * pitch + size / 2;
  const tipY = curveY(columns - 1);
  const angle = Math.atan2(tipY - curveY(columns - 2), pitch);
  const head = [0.5, -0.5].map((d) => `${tipX - 7 * Math.cos(angle + d)},${tipY - 7 * Math.sin(angle + d)}`).join(' ');
  return (
    <svg className="lab-svg" viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges">
      {rects}
      <path className="lab-arrow" d={path} shapeRendering="geometricPrecision" />
      <polygon className="lab-arrowhead" points={`${tipX},${tipY} ${head}`} shapeRendering="geometricPrecision" />
      <text x={0} y={base + 22}>STRIKE 0</text>
      <text x={W} y={base + 22} textAnchor="end">STRIKE 793</text>
    </svg>
  );
}

const RGB: Record<Focus, number[]> = {
  t0: [20, 241, 149],
  t1: [79, 134, 247],
  t2: [153, 69, 255],
  t3: [17, 17, 17],
  melted: [220, 220, 220],
  unissued: [244, 244, 244],
};
const WEIGHT: Record<Focus, number> = { t0: 1, t1: 3, t2: 6, t3: 10, melted: 1, unissued: 1 };

// All Strikes blended into one horizontal gradient, rarer tiers weighted heavier. With a focus,
// only that state is drawn, its intensity by local density.
export function GradientView({ strikes, focus }: { strikes: StrikeRow[]; focus: Focus | null }) {
  const total = strikes.length || 794;
  const slice = (i: number, n: number) =>
    strikes.slice(Math.floor((i * total) / n), Math.max(Math.floor(((i + 1) * total) / n), Math.floor((i * total) / n) + 1));
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  const density = focus
    ? Array.from({ length: 160 }, (_, i) => {
      const g = slice(i, 160);
      return g.filter((s) => stateOf(s) === focus).length / g.length;
    })
    : [];
  const peak = Math.max(1e-9, ...density);
  const stops = Array.from({ length: 160 }, (_, i) => {
    let rgb: number[];
    if (focus) {
      const k = density[i] > 0 ? 0.6 + 0.4 * (density[i] / peak) : 0;
      rgb = RGB[focus].map((v) => 255 + (v - 255) * k);
    } else {
      let r = 0;
      let g = 0;
      let b = 0;
      let w = 0;
      for (const s of slice(i, 160)) {
        const st = stateOf(s);
        const c = RGB[st];
        const wt = WEIGHT[st];
        r += c[0] * wt;
        g += c[1] * wt;
        b += c[2] * wt;
        w += wt;
      }
      rgb = [r / w, g / w, b / w];
    }
    return { at: (i / 159) * 100, colour: `#${rgb.map(hex).join('')}` };
  });
  const hits = Array.from({ length: 40 }, (_, i) => ({ x: (i / 40) * 1200, w: 30, ...groupTip(slice(i, 40)) }));
  return (
    <div className="gradient-wrap">
      <svg className="lab-svg gradient-view" viewBox="0 0 1200 200" preserveAspectRatio="none">
        <defs>
          <linearGradient id="strike-gradient" x1="0" x2="1" y1="0" y2="0">
            {stops.map((s) => <stop key={s.at} offset={`${s.at}%`} stopColor={s.colour} />)}
          </linearGradient>
        </defs>
        <rect className="grad-fill" x={0} y={0} width={1200} height={200} fill="url(#strike-gradient)" />
        {hits.map((h) => <rect key={h.x} className="grad-hit" x={h.x} y={0} width={h.w} height={200} data-tip={h.tip} data-tier={h.tier} />)}
      </svg>
      <div className="grad-ruler" aria-hidden>
        {[0, 100, 200, 300, 400, 500, 600, 700, 793].map((n) => (
          <span key={n} style={{ left: `${(n / 793) * 100}%` }}>{n === 0 ? 'Strike 0' : n === 793 ? '793' : n}</span>
        ))}
      </div>
    </div>
  );
}
