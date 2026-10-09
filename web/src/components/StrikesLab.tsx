import type { ReactElement } from 'react';
import type { StrikeRow } from '../api.ts';
import { TIER_NAMES, tier } from '../format.ts';

// LAB ONLY: four ways to show the same Strike data as the mint sheet, to compare side by side.

const frac = (s: StrikeRow) => (BigInt(s.issued) === 0n ? 0 : Number((BigInt(s.surviving) * 1000n) / BigInt(s.issued)) / 1000);
const issued = (s: StrikeRow) => BigInt(s.issued) > 0n;

// One hover label for a run of Strikes: "Strikes #a to #b" over a count by tier.
const KIND_NAMES: Record<string, string> = { t3: 'Legendary', t2: 'Rare', t1: 'Uncommon', t0: 'Common', melted: 'Melted', unissued: 'not yet issued' };
function kindOf(s: StrikeRow) {
  return !issued(s) ? 'unissued' : BigInt(s.surviving) === 0n ? 'melted' : `t${tier(s.rank)}`;
}
function rangeTip(group: StrikeRow[]): { tip: string; tier: string } {
  const count: Record<string, number> = {};
  group.forEach((s) => (count[kindOf(s)] = (count[kindOf(s)] ?? 0) + 1));
  const order = ['t3', 't2', 't1', 't0', 'melted', 'unissued'].filter((x) => count[x]);
  const top = order.find((x) => x.startsWith('t')) ?? order[0] ?? 'unissued';
  const first = group[0]?.strike ?? 0, last = group[group.length - 1]?.strike ?? first;
  return {
    tip: `Strikes #${first} to #${last}|${order.map((x) => `${count[x]} ${KIND_NAMES[x]}`).join(', ')}`,
    tier: top.startsWith('t') ? top.slice(1) : top === 'melted' ? 'm' : 'u',
  };
}

// 01: the bonding curve. Each Strike is a slice under the curve, in buying order; its height is where
// the curve priced it, its colour is its rarity, and the part that melted shows grey.
function BondingCurve({ strikes }: { strikes: StrikeRow[] }) {
  const W = 1200, H = 420, L = 40, B = 360, T = 40;
  const n = strikes.length || 794;
  const sw = (W - L - 20) / n;
  const top = (i: number) => B - (B - T) * Math.pow(i / (n - 1), 1.9) - 18;
  const curve = Array.from({ length: n }, (_, i) => `${i ? 'L' : 'M'}${(L + i * sw).toFixed(1)} ${top(i).toFixed(1)}`).join(' ');
  return (
    <svg className="lab-svg" viewBox={`0 0 ${W} ${H}`}>
      {strikes.map((s, i) => {
        const x = L + i * sw, y = top(i), h = B - y;
        if (!issued(s)) return null;
        const live = h * frac(s);
        return (
          <g key={s.strike}>
            <rect className="lab-melt" x={x} y={y} width={sw + 0.4} height={h - live} />
            <rect className={`lab-t${tier(s.rank)}`} x={x} y={B - live} width={sw + 0.4} height={live} />
          </g>
        );
      })}
      <path className="lab-line" d={curve} />
      <line className="lab-axis" x1={L} y1={B} x2={W - 20} y2={B} />
      <text x={L} y={B + 24}>STRIKE 0</text>
      <text x={W - 20} y={B + 24} textAnchor="end">STRIKE 793</text>
      <text x={(L + W) / 2} y={B + 24} textAnchor="middle" className="lab-muted">ORDER OF PURCHASE · PRICE RISES ALONG THE CURVE</text>
    </svg>
  );
}

// 01b: the bonding curve in blocks. Columns of square blocks, each a few Strikes in buying order, stacked
// to the curve's height. Surviving tokens are solid blocks in their rarity colours (rarest on top);
// melted tokens and Strikes not yet bought are small dots, so the curve keeps its shape.
export function BitmapCurve({ strikes, width = 1200, height = 440, cell = 7, gap = 2 }: { strikes: StrikeRow[]; width?: number; height?: number; cell?: number; gap?: number }) {
  // Drawn to the exact size it is given, with the mint sheet's own block size and gap.
  const W = Math.max(300, Math.round(width)), H = Math.max(120, Math.round(height)), L = 0, B = H - 26, b = cell, pitch = cell + gap, T = Math.ceil(pitch * 1.4) + 12; // room above the tallest column for the arrow
  const cols = Math.floor((W - L) / pitch), rowsMax = Math.floor((B - T) / pitch);
  const n = strikes.length || 794, per = n / cols;
  const out: ReactElement[] = [];
  for (let c = 0; c < cols; c++) {
    const group = strikes.slice(Math.floor(c * per), Math.floor((c + 1) * per));
    const rows = Math.max(1, Math.round(rowsMax * Math.pow(c / (cols - 1), 2.4)) + 1);
    const x = L + c * pitch;
    const bought = group.filter(issued);
    // Surviving share of this column's tokens, split by tier.
    const live = [0, 0, 0, 0];
    bought.forEach((s) => (live[tier(s.rank)] += frac(s)));
    const blocks: number[] = [];
    if (bought.length) {
      const scale = rows / group.length;
      // Any surviving Uncommon, Rare or Legendary in the column always gets at least one block.
      const want = [0, 1, 2, 3].map((t) => (t > 0 && live[t] > 0 ? Math.max(1, Math.round(live[t] * scale)) : Math.round(live[t] * scale)));
      let over = want.reduce((a, x) => a + x, 0) - rows;
      for (let t = 0; t < 4 && over > 0; t++) {
        const cut = Math.min(over, t === 0 ? want[0] : Math.max(0, want[t] - 1));
        want[t] -= cut;
        over -= cut;
      }
      [0, 1, 2, 3].forEach((t) => {
        for (let k = 0; k < want[t]; k++) blocks.push(t);
      });
    }
    const { tip } = rangeTip(group);
    for (let r = 0; r < rows; r++) {
      const y = B - (r + 1) * pitch;
      const t = blocks[r];
      if (t !== undefined) out.push(<rect key={`${c},${r}`} className={`lab-t${t}`} x={x} y={y} width={b} height={b} data-tip={tip} data-tier={t} />);
      // Same symbols as the sheet: grey block melted, outlined block not yet bought.
      else out.push(<rect key={`${c},${r}`} className={bought.length ? 'lab-gone' : 'lab-future'} x={x} y={y} width={b} height={b} data-tip={tip} data-tier={bought.length ? 'm' : 'u'} />);
    }
  }
  const lift = pitch * 1.4;
  // The true curve, not the rounded block steps, so the arrow reads as a smooth line.
  const curveY = (c: number) => B - (rowsMax * Math.pow(c / (cols - 1), 2.4) + 1) * pitch - lift;
  const arrow = Array.from({ length: 61 }, (_, k) => {
    const c = (k / 60) * (cols - 1);
    return `${k ? 'L' : 'M'}${(L + c * pitch + b / 2).toFixed(1)} ${curveY(c).toFixed(1)}`;
  }).join(' ');
  const ex = L + (cols - 1) * pitch + b / 2, ey = curveY(cols - 1);
  const ang = Math.atan2(ey - curveY(cols - 2), pitch);
  const head = [0.5, -0.5].map((d) => `${ex - 7 * Math.cos(ang + d)},${ey - 7 * Math.sin(ang + d)}`).join(' ');
  return (
    <svg className="lab-svg" viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges">
      {out}
      <path className="lab-arrow" d={arrow} shapeRendering="geometricPrecision" />
      <polygon className="lab-arrowhead" points={`${ex},${ey} ${head}`} shapeRendering="geometricPrecision" />
      <text x={L} y={B + 22}>STRIKE 0</text>
      <text x={W} y={B + 22} textAnchor="end">STRIKE 793</text>
    </svg>
  );
}

// 02: rarity towers. One block per Strike, stacked by tier, rarest first, so scarcity is the shape.
function Towers({ strikes }: { strikes: StrikeRow[] }) {
  const per = 26, b = 10, g = 3, colW = per * (b + g), gap = 40;
  const groups = [3, 2, 1, 0].map((t) => strikes.filter((s) => issued(s) && tier(s.rank) === t));
  const tallest = Math.max(...groups.map((x) => Math.ceil(x.length / per)));
  const H = tallest * (b + g) + 70, W = 4 * colW + 3 * gap;
  return (
    <svg className="lab-svg" viewBox={`0 0 ${W} ${H}`}>
      {groups.map((list, gi) => {
        const ox = gi * (colW + gap), t = 3 - gi;
        return (
          <g key={t}>
            {list.map((s, k) => {
              const x = ox + (k % per) * (b + g), y = H - 50 - (Math.floor(k / per) + 1) * (b + g);
              return <rect key={s.strike} className={BigInt(s.surviving) > 0n ? `lab-t${t}` : 'lab-melt'} x={x} y={y} width={b} height={b} />;
            })}
            <text x={ox} y={H - 22}>{TIER_NAMES[t].toUpperCase()}</text>
            <text x={ox + colW - g} y={H - 22} textAnchor="end" className="lab-muted">{list.length} STRIKES</text>
          </g>
        );
      })}
    </svg>
  );
}

// 03: the spiral, on black. Strike 0 at the centre, each later Strike further out; block size is how much
// survives. The rarity colours read brighter on black, with Legendary in white.
function Spiral({ strikes }: { strikes: StrikeRow[] }) {
  const W = 1200, H = 620, cx = W / 2, cy = H / 2;
  return (
    <svg className="lab-svg lab-dark" viewBox={`0 0 ${W} ${H}`}>
      <rect className="lab-bg" x={0} y={0} width={W} height={H} />
      {strikes.map((s, i) => {
        const r = 10.6 * Math.sqrt(i + 1), a = i * 2.39996;
        const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
        if (!issued(s)) return <rect key={s.strike} className="lab-dim" x={x - 1} y={y - 1} width={2} height={2} />;
        const sz = 3 + 7 * frac(s);
        return <rect key={s.strike} className={`lab-t${tier(s.rank)}`} x={x - sz / 2} y={y - sz / 2} width={sz} height={sz} />;
      })}
      <text x={24} y={H - 24} className="lab-onblack">STRIKE 0 AT THE CENTRE · BLOCK SIZE IS HOW MUCH SURVIVES</text>
    </svg>
  );
}

// 04: the rank staircase. Every issued Strike sorted from lowest to highest rank, as a rising chart.
function Staircase({ strikes }: { strikes: StrikeRow[] }) {
  const list = strikes.filter(issued).sort((a, b) => a.rank - b.rank || a.strike - b.strike);
  const W = 1200, H = 420, L = 20, B = 360, T = 40;
  const max = Math.max(1, ...list.map((s) => s.rank));
  const bw = (W - L - 20) / Math.max(1, list.length);
  const top = list[list.length - 1];
  return (
    <svg className="lab-svg" viewBox={`0 0 ${W} ${H}`}>
      {list.map((s, i) => {
        const h = 6 + (B - T - 6) * (s.rank / max);
        return <rect key={s.strike} className={`lab-t${tier(s.rank)}`} x={L + i * bw} y={B - h} width={bw + 0.4} height={h} />;
      })}
      <line className="lab-axis" x1={L} y1={B} x2={W - 20} y2={B} />
      <text x={L} y={B + 24}>RANK 0</text>
      {top && <text x={W - 20} y={T - 12} textAnchor="end">STRIKE #{top.strike} · RANK {top.rank}</text>}
      <text x={W - 20} y={B + 24} textAnchor="end" className="lab-muted">EVERY ISSUED STRIKE, LOWEST TO HIGHEST RANK</text>
    </svg>
  );
}

const VARIANTS = [
  { n: '01', name: 'Bonding curve', line: 'each Strike under the curve that priced it, coloured by rarity.', V: BondingCurve },
  { n: '01b', name: 'Bitmap curve', line: 'the same curve, built from the site\'s blocks.', V: BitmapCurve },
  { n: '02', name: 'Rarity towers', line: 'one block per Strike, rarest first, so scarcity is the shape.', V: Towers },
  { n: '03', name: 'Spiral', line: 'every Strike spiralling out from Strike 0, on black.', V: Spiral },
  { n: '04', name: 'Rank staircase', line: 'every Strike ranked low to high, a rising chart.', V: Staircase },
];

export function StrikesLab({ strikes }: { strikes: StrikeRow[] }) {
  return (
    <div className="lab">
      {VARIANTS.map(({ n, name, line, V }) => (
        <section key={n} className="lab-item">
          <div className="lab-head">
            <h2>{n} {name}</h2>
            <p className="muted">{line}</p>
          </div>
          <div className="frame lab-frame"><V strikes={strikes} /></div>
        </section>
      ))}
      <div className="lab-legend legend">
        {TIER_NAMES.map((t, i) => <span key={t}><i className={`swatch t${i}`} />{t}</span>)}
        <span><i className="swatch melted-swatch" />Melted</span>
      </div>
    </div>
  );
}

// The same Strikes as one continuous gradient, in buying order. Each stop mixes the colours of the Strikes
// around it, rarer tiers weighted more so they show through; melted pulls toward grey, unbought toward white.
// With a tier picked in the key, only that tier keeps its colour.
const RGB: Record<string, [number, number, number]> = {
  t0: [0x14, 0xf1, 0x95], t1: [0x4f, 0x86, 0xf7], t2: [0x99, 0x45, 0xff], t3: [0x11, 0x11, 0x11],
  melted: [0xdc, 0xdc, 0xdc], unissued: [0xf4, 0xf4, 0xf4],
};
const WEIGHT: Record<string, number> = { t0: 1, t1: 3, t2: 6, t3: 10, melted: 1, unissued: 1 };

export function GradientView({ strikes, focus }: { strikes: StrikeRow[]; focus: string | null }) {
  // Fine bands of colour, one stop for every few Strikes (the chosen version).
  const buckets = 160;
  const n = strikes.length || 794;
  const groupAt = (k: number, parts: number) =>
    strikes.slice(Math.floor((k * n) / parts), Math.max(Math.floor(((k + 1) * n) / parts), Math.floor((k * n) / parts) + 1));
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  // With a tier picked, each band shows how much of it sits there: its share of the band's Strikes,
  // scaled so the densest band is full colour and bands without it are white.
  const share = focus ? Array.from({ length: buckets }, (_, k) => {
    const g = groupAt(k, buckets);
    return g.filter((s) => kindOf(s) === focus).length / g.length;
  }) : [];
  const peak = Math.max(1e-9, ...share);
  const stops = Array.from({ length: buckets }, (_, k) => {
    let rgb: number[];
    if (focus) {
      // Any band with this tier shows strongly; denser bands go deeper.
      const f = share[k] > 0 ? 0.6 + 0.4 * (share[k] / peak) : 0, c = RGB[focus];
      rgb = c.map((v) => 255 + (v - 255) * f);
    } else {
      let r = 0, g = 0, b = 0, w = 0;
      for (const s of groupAt(k, buckets)) {
        const kind = kindOf(s), c = RGB[kind], wt = WEIGHT[kind];
        r += c[0] * wt; g += c[1] * wt; b += c[2] * wt; w += wt;
      }
      rgb = [r / w, g / w, b / w];
    }
    return { at: (k / (buckets - 1)) * 100, colour: `#${rgb.map(hex).join('')}` };
  });
  // Invisible stretches on top of the gradient, each with a hover label.
  const segs = 40;
  const hits = Array.from({ length: segs }, (_, k) => ({ x: (k / segs) * 1200, w: 1200 / segs, ...rangeTip(groupAt(k, segs)) }));
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
        {[0, 100, 200, 300, 400, 500, 600, 700, 793].map((v) => (
          <span key={v} style={{ left: `${(v / 793) * 100}%` }}>{v === 0 ? 'Strike 0' : v === 793 ? '793' : v}</span>
        ))}
      </div>
    </div>
  );
}
