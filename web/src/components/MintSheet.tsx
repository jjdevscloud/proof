import type { CSSProperties } from 'react';
import type { StrikeRow } from '../api.ts';
import { TIER_NAMES, fmtTokens, tier } from '../format.ts';

// Every strike as one cell: colour = rarity tier, fill = share still surviving,
// dashed = not yet bought off the curve.
export function MintSheet({ strikes, filter = 'all' }: { strikes: StrikeRow[]; filter?: 'all' | 'rare' | 'surviving' }) {
  return (
    <div className="sheet" role="list">
      {strikes.map((s) => {
        const issued = BigInt(s.issued);
        const surviving = BigInt(s.surviving);
        const frac = issued === 0n ? 0 : Number((surviving * 1000n) / issued) / 1000;
        const dim = (filter === 'rare' && s.rank === 0) || (filter === 'surviving' && surviving === 0n);
        const state = issued === 0n ? 'unissued' : surviving === 0n ? 'melted' : 'live';
        const label = `Strike #${s.strike} · ${TIER_NAMES[tier(s.rank)]}${s.traits ? ` · ${s.traits.join(', ')}` : ''} · ${
          issued === 0n ? 'not yet issued' : `${fmtTokens(s.surviving)} of ${fmtTokens(s.issued)} surviving`}`;
        return (
          <a
            key={s.strike}
            role="listitem"
            href={`#/strike/${s.strike}`}
            className={`cell t${tier(s.rank)} ${state}${dim ? ' dim' : ''}`}
            style={{ '--f': frac } as CSSProperties}
            title={label}
            aria-label={label}
          />
        );
      })}
    </div>
  );
}

export function SheetLegend() {
  return (
    <div className="legend small">
      {TIER_NAMES.map((n, i) => (
        <span key={n}><i className={`swatch t${i}`} />{n}</span>
      ))}
      <span><i className="swatch melted-swatch" />Melted</span>
      <span><i className="swatch unissued-swatch" />Not yet issued</span>
    </div>
  );
}
