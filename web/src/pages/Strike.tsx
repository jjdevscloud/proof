import { useState } from 'react';
import { useApi } from '../api.ts';
import type { RevealStatus, Stats, StrikeDetail } from '../api.ts';
import { useConfig } from '../App.tsx';
import { TIER_NAMES, explorer, fmtTokens, pct, tier } from '../format.ts';
import { matches, verifyReveal } from '../verify.ts';
import type { Verification } from '../verify.ts';
import { ActivityFeed } from '../components/Activity.tsx';
import { Addr, Bar, ErrorNote, Loading, StrikeCoin, Traits } from '../components/ui.tsx';
import { shareText } from '../components/TraitIcons.tsx';

export function StrikePage({ n }: { n: number }) {
  const config = useConfig();
  const valid = Number.isInteger(n) && n >= 0 && n < config.strikeCount;
  const { data, error } = useApi<StrikeDetail>(valid ? `/strike/${n}` : null);
  // How many Strikes share this one's rarity, from the live counts by rank.
  const stats = useApi<Stats>('/stats');

  if (!valid) return <ErrorNote error={`There is no Strike #${n}. Strikes run from #0 to #${config.strikeCount - 1}.`} />;
  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Loading />;

  const issued = BigInt(data.issued);
  const first = BigInt(n) * BigInt(config.strikeSize) / 1_000_000n;
  return (
    <>
      <nav className="crumbs small"><a className="back-link" href="#/strikes">← Back to Strikes</a></nav>
      <section className="strike-hero panel">
        <StrikeCoin strike={n} rank={data.rank} size="lg" part={data.surviving} whole={data.issued} />
        {/* A profile: the name with its trait tags (symbol and name) under it, then plain labelled details. */}
        <div className="profile">
          <div className="profile-name">
            <h1>Strike #{n}</h1>
            <Traits traits={data.traits} rank={data.rank} share />
          </div>
          <dl className="profile-details">
            <dt>Rarity</dt><dd>{TIER_NAMES[tier(data.rank)]}{(() => {
              const by = stats.data?.byRank ?? [];
              const all = by.reduce((a, r) => a + r.strikes, 0);
              const same = by.filter((r) => tier(r.rank) === tier(data.rank)).reduce((a, r) => a + r.strikes, 0);
              return all ? <span className="muted">, {shareText(same, all)} of Strikes</span> : null;
            })()}</dd>
            <dt>Rank</dt><dd>{data.rank}</dd>
            <dt>Tokens</dt><dd>#{first.toLocaleString()} to #{(first + BigInt(data.size) / 1_000_000n - 1n).toLocaleString()}</dd>
          </dl>
        </div>
        <div className="strike-hero-stat profile">
          {issued === 0n ? (
            <p className="muted">Not yet bought off the curve.</p>
          ) : (
            <>
              <div className="profile-name"><h1>{pct(data.surviving, data.issued)}% surviving</h1></div>
              <Bar value={pct(data.surviving, data.issued)} tierClass={`t${tier(data.rank)}`} />
              <dl className="profile-details">
                <dt>Surviving</dt><dd>{fmtTokens(data.surviving)}</dd>
                <dt>Issued</dt><dd>{fmtTokens(data.issued)}</dd>
                <dt>Melted</dt><dd>{fmtTokens(BigInt(data.issued) - BigInt(data.surviving))}</dd>
              </dl>
            </>
          )}
        </div>
      </section>

      <div className="grid-2">
        <section className="panel">
          <h2>Where it survives</h2>
          {!data.pieces.length ? (
            <p className="muted">{issued === 0n ? 'Nothing issued yet.' : 'Every token of this Strike has melted.'}</p>
          ) : (
            <table className="table">
              <thead><tr><th>Holder</th><th>Held in</th><th className="num">Tokens</th></tr></thead>
              <tbody>
                {data.pieces.map((p) => (
                  <tr key={p.account}>
                    <td><Addr value={p.holder} href={p.holder ? `#/wallet/${p.holder}` : undefined} /></td>
                    <td>{p.envelope ? <span className="pill pill-seal">Sealed envelope</span> : <span className="pill">Origin wallet</span>}</td>
                    <td className="num mono">{fmtTokens(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <VerifyPanel n={n} traits={data.traits} />
      </div>

      <section className="panel">
        <h2>History</h2>
        <ActivityFeed items={data.history} empty="No recorded activity for this Strike." />
      </section>
    </>
  );
}

function VerifyPanel({ n, traits }: { n: number; traits: string[] | null }) {
  const config = useConfig();
  const { data: reveal } = useApi<RevealStatus>('/reveal');
  const [state, setState] = useState<{ status: 'idle' | 'running' | 'done' | 'error'; v?: Verification; error?: string }>({ status: 'idle' });

  const run = async () => {
    setState({ status: 'running' });
    try {
      setState({ status: 'done', v: await verifyReveal(config) });
    } catch (e) {
      setState({ status: 'error', error: (e as Error).message });
    }
  };
  const v = state.v;
  const strikeOk = v ? v.ok && matches(v, n, traits) : false;

  return (
    <section className="panel verify">
      <h2>Verify these traits</h2>
      <p className="muted small verify-line">Your browser can recompute everything itself, no trust in this website needed.</p>
      {!reveal?.revealed ? (
        <SeedStatus reveal={reveal ?? null} />
      ) : (
        <>
          <button className="btn btn-ghost" onClick={run} disabled={state.status === 'running'}>
            {state.status === 'running' ? 'Checking the chain…' : 'Verify in my browser'}
          </button>
          {v && (
            <ul className="checks">
              {[...v.steps, { label: `Strike #${n} is ${traits?.join(', ') ?? 'unrevealed'}`, ok: matches(v, n, traits), detail: '' }].map((s) => (
                <li key={s.label} className={s.ok ? 'ok' : 'bad'}>
                  <span aria-hidden>{s.ok ? '✓' : '✗'}</span>
                  <span>{s.label}{s.detail && <span className="muted small">, {s.detail}</span>}</span>
                </li>
              ))}
            </ul>
          )}
          {v && (strikeOk
            ? <p className="verify-ok">✓ Verified. Strike #{n}'s traits follow from the committed rules and the public seed.</p>
            : <p className="error-note">✗ Verification failed. Do not trust these traits.</p>)}
          {state.error && <p className="error-note">{state.error}</p>}
        </>
      )}
      <dl className="kv small">
        <dt>Rules commitment</dt><dd className="mono">{config.commitRoot ? `${config.commitRoot.slice(0, 20)}…` : '—'}</dd>
        <dt>Posted by</dt><dd><a className="mono" href={explorer('address', config.revealAuthority)} target="_blank" rel="noreferrer">{config.revealAuthority.slice(0, 8)}… (see its first memo)</a></dd>
      </dl>
    </section>
  );
}

export function SeedStatus({ reveal }: { reveal: RevealStatus | null }) {
  if (!reveal?.commitRoot) return <p className="muted">The trait rules have not been committed yet.</p>;
  return (
    <div className="small">
      <p className="muted">
        Traits are revealed after the seed block: 150 slots after the curve sells out, or slot{' '}
        <span className="mono">{reveal.deadlineSlot?.toLocaleString()}</span> at the latest. Until then everyone buys blind.
      </p>
      <dl className="kv">
        <dt>Curve sold out</dt><dd>{reveal.completionSlot ? <span className="mono">slot {reveal.completionSlot.toLocaleString()}</span> : 'not yet'}</dd>
        <dt>Seed slot</dt><dd className="mono">{reveal.seedTargetSlot?.toLocaleString()}{reveal.seedFixed ? ' (passed)' : ''}</dd>
        {reveal.eligibleStrikes !== null && <><dt>Eligible Strikes</dt><dd className="mono">{reveal.eligibleStrikes}</dd></>}
      </dl>
    </div>
  );
}
