import { useState } from 'react';
import { api, useApi } from '../api.ts';
import type { Proof, StrikeDetail } from '../api.ts';
import { useConfig } from '../App.tsx';
import { TIER_NAMES, explorer, fmtTokens, pct, tier } from '../format.ts';
import { verifyStrike } from '../verify.ts';
import { ActivityFeed } from '../components/Activity.tsx';
import { Addr, Bar, ErrorNote, Loading, StrikeCoin, Traits } from '../components/ui.tsx';

export function StrikePage({ n }: { n: number }) {
  const config = useConfig();
  const valid = Number.isInteger(n) && n >= 0 && n < config.strikeCount;
  const { data, error } = useApi<StrikeDetail>(valid ? `/strike/${n}` : null);

  if (!valid) return <ErrorNote error={`There is no Strike #${n}. Strikes run from #0 to #${config.strikeCount - 1}.`} />;
  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Loading />;

  const issued = BigInt(data.issued);
  const first = BigInt(n) * BigInt(config.strikeSize) / 1_000_000n;
  return (
    <>
      <nav className="crumbs small"><a href="#/strikes">Strikes</a> / #{n}</nav>
      <section className="strike-hero panel">
        <StrikeCoin strike={n} rank={data.rank} size="lg" />
        <div>
          <h1>Strike #{n}</h1>
          <Traits traits={data.traits} rank={data.rank} />
          <p className="muted small">
            {TIER_NAMES[tier(data.rank)]} · rank {data.rank} · tokens #{first.toLocaleString()} – #{(first + BigInt(data.size) / 1_000_000n - 1n).toLocaleString()}
          </p>
        </div>
        <div className="strike-hero-stat">
          {issued === 0n ? (
            <p className="muted">Not yet bought off the curve.</p>
          ) : (
            <>
              <div className="stat-value">{pct(data.surviving, data.issued)}%</div>
              <div className="stat-sub">{fmtTokens(data.surviving)} of {fmtTokens(data.issued)} surviving</div>
              <Bar value={pct(data.surviving, data.issued)} tierClass={`t${tier(data.rank)}`} />
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
        <VerifyPanel n={n} />
      </div>

      <section className="panel">
        <h2>History</h2>
        <ActivityFeed items={data.history} empty="No recorded activity for this Strike." />
      </section>
    </>
  );
}

function VerifyPanel({ n }: { n: number }) {
  const config = useConfig();
  const [state, setState] = useState<{ status: 'idle' | 'running' | 'ok' | 'fail'; detail?: string; root?: string }>({ status: 'idle' });

  const run = async () => {
    setState({ status: 'running' });
    try {
      const proof = await api<Proof>(`/proof/${n}`);
      const res = await verifyStrike(proof);
      // The root must also be the one committed on-chain before launch, not just the indexer's.
      const committed = config.commitRoot;
      const ok = res.ok && committed === proof.root;
      setState({ status: ok ? 'ok' : 'fail', root: res.computedRoot, detail: ok ? undefined : !res.ok ? 'The proof does not reproduce the root.' : 'Root differs from the on-chain commitment.' });
    } catch (e) {
      setState({ status: 'fail', detail: (e as Error).message });
    }
  };

  return (
    <section className="panel verify">
      <h2>Verify these traits</h2>
      <p className="muted small">
        Before launch, a fingerprint of every Strike's traits was posted on-chain. Your browser can check this Strike against it —
        no trust in this website needed.
      </p>
      {!config.revealed ? (
        <p className="muted">Traits are revealed after launch. Verification opens then.</p>
      ) : (
        <>
          <button className="btn btn-ghost" onClick={run} disabled={state.status === 'running'}>
            {state.status === 'running' ? 'Checking…' : 'Verify in my browser'}
          </button>
          {state.status === 'ok' && (
            <p className="verify-ok">✓ Verified. Strike #{n}'s traits match the commitment posted before launch.</p>
          )}
          {state.status === 'fail' && <p className="error-note">✗ Verification failed. {state.detail}</p>}
        </>
      )}
      <dl className="kv small">
        <dt>Committed root</dt><dd className="mono">{config.commitRoot ? `${config.commitRoot.slice(0, 20)}…` : '—'}</dd>
        <dt>Posted by</dt><dd><a className="mono" href={explorer('address', config.revealAuthority)} target="_blank" rel="noreferrer">{config.revealAuthority.slice(0, 8)}… (see its first memo)</a></dd>
      </dl>
    </section>
  );
}
