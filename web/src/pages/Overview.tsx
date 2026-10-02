import { useApi } from '../api.ts';
import type { Stats, StrikeRow, TxChanges } from '../api.ts';
import { TIER_NAMES, fmtCompact, pct, tier } from '../format.ts';
import { ActivityFeed } from '../components/Activity.tsx';
import { MintSheet, SheetLegend } from '../components/MintSheet.tsx';
import { Bar, ErrorNote, Loading, Stat } from '../components/ui.tsx';

export function Overview() {
  const stats = useApi<Stats>('/stats');
  const strikes = useApi<StrikeRow[]>('/strikes');
  const activity = useApi<TxChanges[]>('/activity?limit=30');
  const s = stats.data;

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Sequents · the $PROOF collector ledger</p>
        <h1>Every token costs the same.<br />Some of them are rare.</h1>
        <p className="lede">
          Rarity survives only in the wallet that bought it off the curve — or sealed in an envelope.
          Anything that leaves either place <strong className="melt-word">melts</strong> into ordinary $PROOF, forever.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="#/wallet">Check my wallet</a>
          <a className="btn btn-ghost" href="#/rules">How it works</a>
        </div>
      </section>

      {stats.error && <ErrorNote error={stats.error} />}
      {s && (
        <section className="stats-row">
          <Stat
            label="Rarity surviving"
            value={`${pct(s.surviving, s.issued)}%`}
            sub={`${fmtCompact(s.surviving)} of ${fmtCompact(s.issued)} issued tokens`}
          />
          <Stat label="Melted forever" value={fmtCompact(s.melted)} sub="tokens that left their origin" />
          <Stat label="Sealed in envelopes" value={fmtCompact(s.sealed)} sub={`${s.envelopes} envelope${s.envelopes === 1 ? '' : 's'}`} />
          <Stat label="On the desk" value={s.listed} sub={<a href="#/desk">Browse listings →</a>} />
        </section>
      )}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>The mint sheet</h2>
            <a href="#/strikes" className="small">All strikes →</a>
          </div>
          <p className="muted small">Each square is a Strike of 1,000,000 tokens. Colour is rarity; fill is how much still survives.</p>
          {strikes.data ? <MintSheet strikes={strikes.data} /> : <Loading />}
          <SheetLegend />
        </section>

        <section className="panel">
          <h2>Survival by rarity</h2>
          {!s ? <Loading /> : !s.revealed ? (
            <p className="muted">Traits are sealed until the reveal. Until then every Strike counts as equal, and the highest-numbered tokens leave a wallet first.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Rarity</th><th className="num">Strikes</th><th>Surviving</th></tr>
              </thead>
              <tbody>
                {s.byRank.map((r) => (
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
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Live activity</h2>
          <span className="live small"><span className="dot" /> live</span>
        </div>
        {activity.data ? <ActivityFeed items={activity.data} /> : <Loading />}
      </section>
    </>
  );
}
