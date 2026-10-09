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
            aria-label={label}
            data-tip={`Strike #${s.strike}|${TIER_NAMES[tier(s.rank)]}${s.traits ? ` · ${s.traits.join(', ')}` : ''} · ${issued === 0n ? 'not yet issued' : `${fmtTokens(s.surviving)} of ${fmtTokens(s.issued)} surviving`}`}
            data-tier={issued === 0n ? 'u' : surviving === 0n ? 'm' : tier(s.rank)}
          />
        );
      })}
    </div>
  );
}

export type KeyFocus = 't0' | 't1' | 't2' | 't3' | 'melted' | 'unissued' | null;

// Hover previews a tier; click locks it (click again to release).
// `shares` puts each rarity's share of all Strikes beside it.
export function SheetLegend({ focus = null, onFocus, onPin, shares }: { focus?: KeyFocus; onFocus?: (f: KeyFocus) => void; onPin?: (f: KeyFocus) => void; shares?: string[] } = {}) {
  const item = (f: Exclude<KeyFocus, null>, swatch: string, label: string, note?: string) => (
    <button
      key={f}
      type="button"
      className={focus === f ? 'key-item on' : 'key-item'}
      onMouseEnter={() => onFocus?.(f)}
      onMouseLeave={() => onFocus?.(null)}
      onFocus={() => onFocus?.(f)}
      onBlur={() => onFocus?.(null)}
      onClick={() => onPin?.(f)}
      aria-pressed={focus === f}
    >
      <i className={`swatch ${swatch}`} />{label}{note && <span className="key-share">{note}</span>}
    </button>
  );
  return (
    <div className={onFocus ? 'legend small key-interactive' : 'legend small'}>
      {onFocus && <span className="key-hint">Filter</span>}
      {TIER_NAMES.map((n, i) => item(`t${i}` as Exclude<KeyFocus, null>, `t${i}`, n, shares?.[i]))}
      {item('melted', 'melted-swatch', 'Melted')}
      {item('unissued', 'unissued-swatch', 'Not yet issued')}
    </div>
  );
}
