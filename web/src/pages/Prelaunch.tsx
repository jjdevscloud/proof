import { useApi } from '../api.ts';
import { tier } from '../format.ts';
import { ErrorNote, Loading } from '../components/ui.tsx';
import { More } from '../components/More.tsx';

type RulesResponse = {
  final: boolean;
  rules: {
    strikeCount: number;
    deadlineSlot: number;
    dates: { name: string; from: number; to: number; points: number }[];
    defaultDate: { name: string; points: number };
    errors: { name: string; count: number; points: number }[];
  };
};

const REPO_RULES = 'https://github.com/jjdevscloud/proof/blob/main/rules/sequents-v1.template.json';

// Chance that someone holding `m` of `n` Strikes owns at least one of `k` specific Strikes.
function odds(n: number, k: number, m: number): number {
  let none = 1;
  for (let i = 0; i < m; i++) none *= (n - k - i) / (n - i);
  return 1 - none;
}
const pct = (x: number) => `${x < 0.1 ? (x * 100).toFixed(1) : Math.round(x * 100)}%`;

export function Prelaunch() {
  const { data, error } = useApi<RulesResponse>('/rules');
  const r = data?.rules;
  const errorTotal = r?.errors.reduce((t, e) => t + e.count, 0) ?? 0;

  return (
    <>
      <section className="hero">
        <h1>Launching soon.</h1>
        <More>
        <p className="lede">
          Every $PROOF token will cost the same. Some of them will be rare. Rarity survives only in the wallet that bought it
          off the curve, or sealed in an envelope. Anything that leaves either place <strong className="melt-word">melts</strong>,
          forever.
        </p>
        </More>
        <div className="hero-actions">
          <a className="btn btn-primary" href="#/rules">How it works</a>
          <a className="btn btn-ghost" href={REPO_RULES} target="_blank" rel="noreferrer">Read the rules file</a>
        </div>
      </section>

      <section className="stats-row">
        <div className="stat"><div className="stat-label">Status</div><div className="stat-value">Pending</div><div className="stat-sub">token not created yet</div></div>
        <div className="stat"><div className="stat-label">Strikes</div><div className="stat-value">{r?.strikeCount ?? '—'}</div><div className="stat-sub">1,000,000 tokens each</div></div>
        <div className="stat"><div className="stat-label">Random errors</div><div className="stat-value">{errorTotal || '—'}</div><div className="stat-sub">{r ? `${pct(errorTotal / r.strikeCount)} of Strikes` : ''}</div></div>
        <div className="stat"><div className="stat-label">Trait commitment</div><div className="stat-value">{data?.final ? 'Posted' : 'At launch'}</div><div className="stat-sub">on-chain, before the first buy</div></div>
      </section>

      {error && <ErrorNote error={error} />}
      {!r && !error && <Loading />}
      {r && (
        <div className="grid-2">
          <section className="panel">
            <h2>Random errors</h2>
            <More><p className="muted small">
              Assigned after the sale from a public Solana block, so nobody, including the team, can know or target them.
              At most one per Strike.
            </p></More>
            <table className="table">
              <thead><tr><th>Error</th><th className="num">Strikes</th><th className="num">Points</th><th className="num">1 Strike</th><th className="num">10 Strikes</th></tr></thead>
              <tbody>
                {r.errors.map((e) => (
                  <tr key={e.name}>
                    <td><span className={`tier-dot t${tier(e.points)}`} />{e.name}</td>
                    <td className="num mono">{e.count}</td>
                    <td className="num mono">{e.points}</td>
                    <td className="num mono">{pct(odds(r.strikeCount, e.count, 1))}</td>
                    <td className="num mono">{pct(odds(r.strikeCount, e.count, 10))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Odds of owning at least one, if all Strikes are sold.</p>
          </section>

          <section className="panel">
            <h2>Date tiers</h2>
            <More><p className="muted small">Positional and public from the start: the earliest Strikes off the curve.</p></More>
            <table className="table">
              <thead><tr><th>Tier</th><th>Strikes</th><th className="num">Points</th></tr></thead>
              <tbody>
                {r.dates.map((d) => (
                  <tr key={d.name}>
                    <td><span className={`tier-dot t${tier(d.points)}`} />{d.name}</td>
                    <td className="mono small">{d.from === d.to ? `#${d.from}` : `#${d.from}–#${d.to}`}</td>
                    <td className="num mono">{d.points}</td>
                  </tr>
                ))}
                <tr><td><span className="tier-dot t0" />{r.defaultDate.name}</td><td className="small muted">all others</td><td className="num mono">{r.defaultDate.points}</td></tr>
              </tbody>
            </table>
            <p className="muted small">
              A Strike's rank is its date points plus its error points. A Genesis Double Die scores 140, the top of the
              collection. The top errors outrank any date tier.
            </p>
          </section>
        </div>
      )}

      <section className="panel">
        <h2>How the launch works</h2>
        <More>
        <ol className="steps">
          <li><strong>Commitment.</strong> Minutes before the token is created, a fingerprint of the rules above is posted on-chain, with a reveal deadline.</li>
          <li><strong>Launch.</strong> $PROOF goes live on pump.fun. Every token bought off the curve gets a number; each 1,000,000 is a Strike.</li>
          <li><strong>Seed.</strong> When the curve sells out (or at the deadline), the next Solana block's hash becomes the public seed. Only Strikes sold by then can receive errors.</li>
          <li><strong>Reveal.</strong> Traits are published, and anyone can recompute every Strike in their own browser from the rules and that block.</li>
        </ol>
        </More>
      </section>
    </>
  );
}
