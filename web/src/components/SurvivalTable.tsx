import type { Stats } from '../api.ts';
import { TIER_NAMES, fmtTokens, pct, tier } from '../format.ts';

// Survival by rarity: one row per rank, with a block meter, the tokens left and the share surviving.

type Row = Stats['byRank'][number];

// A row of blocks, lit by the share: the site's block meter.
function Blocks({ share, n = 20, tierClass }: { share: number; n?: number; tierClass: string }) {
  const lit = Math.round(share * n);
  return (
    <span className={`sv-blocks ${tierClass}`} aria-hidden>
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < lit ? 'on' : ''} />)}
    </span>
  );
}

const share = (r: { surviving: string | bigint; issued: string | bigint }) => (BigInt(r.issued) === 0n ? 0 : Number((BigInt(r.surviving) * 1000n) / BigInt(r.issued)) / 1000);

function byTier(rows: Row[]) {
  const out = [0, 1, 2, 3].map((t) => ({ t, strikes: 0, issued: 0n, surviving: 0n, ranks: [] as number[] }));
  for (const r of rows) {
    const g = out[tier(r.rank)];
    g.strikes += r.strikes;
    g.issued += BigInt(r.issued);
    g.surviving += BigInt(r.surviving);
    g.ranks.push(r.rank);
  }
  return out;
}


export function SurvivalTable({ rows }: { rows: Row[] }) {
  return (
    <table className="table sv-table">
      <thead>
        <tr><th>Rarity</th><th className="num">Rank</th><th className="num">Strikes</th><th>Surviving</th><th className="num">Tokens</th><th className="num">Share</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.rank}>
            <td><span className="sv-name"><i className={`tier-dot t${tier(r.rank)}`} />{TIER_NAMES[tier(r.rank)]}</span></td>
            <td className="num">{r.rank}</td>
            <td className="num">{r.strikes}</td>
            <td><Blocks share={share(r)} tierClass={`t${tier(r.rank)}`} /></td>
            <td className="num">{fmtTokens(r.surviving)}</td>
            <td className="num"><strong>{BigInt(r.issued) === 0n ? 'None' : `${pct(r.surviving, r.issued)}%`}</strong></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
