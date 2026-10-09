// The roll (SPEC §4.5): seal ordinary $PROOF into an envelope, pay a small SOL fee, and the next
// blocks decide which tier it becomes. The browser computes the result itself from the seed block.
import { useEffect, useState } from 'react';
import { useApi } from '../api.ts';
import type { Envelope, Rolls, WalletView } from '../api.ts';
import type { RollRules } from '../../../indexer/src/derive.ts';
import { useConfig, useVault } from '../App.tsx';
import { BASE, TIER_NAMES, explorer, fmtTokens, short, sol, tier } from '../format.ts';
import { ErrorNote, Loading, Modal, runTx } from './ui.tsx';
import { coinCells } from './pixels.tsx';

const COIN = coinCells(7, 5, 0);

function RollCoin({ points, spinning = false }: { points: number | null; spinning?: boolean }) {
  return (
    <span className={`roll-coin ${points === null ? 'roll-coin-blank' : `t${tier(points)}`}${spinning ? ' roll-coin-spin' : ''}`} aria-hidden>
      <svg viewBox="0 0 7 5" shapeRendering="crispEdges">
        {COIN.map(([x, y], i) => <rect key={i} x={x + 0.07} y={y + 0.07} width={0.86} height={0.86} />)}
      </svg>
    </span>
  );
}

export const odds = (n: number) => {
  const pct = n / 10_000;
  return pct >= 1 ? `${pct}%` : `${pct.toFixed(2).replace(/0$/, '')}%`;
};

export function RollBadge({ e }: { e: Pick<Envelope, 'roll' | 'rolling'> }) {
  if (e.rolling) return <span className="pill roll-badge roll-pending">Rolling…</span>;
  if (!e.roll) return null;
  const t = tier(e.roll.points);
  return <span className={`pill roll-badge t${t}`}>{e.roll.name} · {TIER_NAMES[t]}</span>;
}

export function OddsTable({ roll }: { roll: RollRules }) {
  const winOdds = roll.tiers.reduce((t, x) => t + x.odds, 0);
  return (
    <table className="odds">
      <thead>
        <tr><th>Result</th><th>Rarity</th><th className="num">Points</th><th className="num">Chance</th></tr>
      </thead>
      <tbody>
        {roll.tiers.map((t) => (
          <tr key={t.name}>
            <td><RollCoin points={t.points} /> {t.name}</td>
            <td className={`t${tier(t.points)}-text`}>{TIER_NAMES[tier(t.points)]}</td>
            <td className="num mono">{t.points}</td>
            <td className="num mono">{odds(t.odds)}</td>
          </tr>
        ))}
        <tr>
          <td><RollCoin points={roll.fallback.points} /> {roll.fallback.name}</td>
          <td>{TIER_NAMES[tier(roll.fallback.points)]}</td>
          <td className="num mono">{roll.fallback.points}</td>
          <td className="num mono">{odds(1_000_000 - winOdds)}</td>
        </tr>
      </tbody>
    </table>
  );
}

// "Striking…" until the seed block is confirmed, then the result.
export function RollReveal({ signature, onClose }: { signature: string; onClose: () => void }) {
  const vault = useVault();
  const [result, setResult] = useState<{ name: string; points: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    vault.rollOutcome(signature).then((r) => live && setResult(r)).catch((e) => live && setErr((e as Error).message));
    return () => {
      live = false;
    };
  }, [vault, signature]);
  const t = result ? tier(result.points) : 0;
  return (
    <Modal title={result ? 'Your roll' : 'Striking…'} onClose={onClose}>
      <div className={`roll-reveal${result ? ` roll-done t${t}` : ''}`}>
        <RollCoin points={result?.points ?? null} spinning={!result && !err} />
        {result ? (
          <>
            <strong className="roll-name">{result.name}</strong>
            <span className="roll-tier">{TIER_NAMES[t]} · {result.points} points</span>
          </>
        ) : (
          <span className="muted small">{err ? '' : 'The next Solana block decides…'}</span>
        )}
      </div>
      {err && <ErrorNote error={err} />}
      {result && (
        <p className="small muted">
          {result.points > 0
            ? 'Your envelope now carries this rare tier. List it on the collector desk, gift it, or keep it. Withdrawing the tokens melts it back to ordinary.'
            : 'Ordinary this time. You can roll the same envelope again from your wallet.'}{' '}
          Computed in your browser from the seed block; the ledger records it once the block is finalized (~20 s).
        </p>
      )}
      <button className="btn btn-primary wide" onClick={onClose}>{result ? 'Done' : 'Close'}</button>
    </Modal>
  );
}

// Wallet panel: seal ordinary tokens from the main token account and roll them in one transaction.
export function RollPanel({ owner, data }: { owner: string; data: WalletView }) {
  const config = useConfig();
  const vault = useVault();
  const roll = config.roll;
  const [main, setMain] = useState<{ account: string; balance: bigint } | null>(null);
  const [amount, setAmount] = useState('');
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [revealing, setRevealing] = useState<string | null>(null);

  useEffect(() => {
    if (!roll) return;
    let live = true;
    vault.mainTokenAccount(owner).then((m) => live && setMain(m)).catch(() => live && setMain(null));
    return () => {
      live = false;
    };
  }, [vault, owner, roll, data]);
  if (!roll) return null;

  // Only ordinary tokens are sealed: never more than the account holds beyond its rare positions,
  // so no rare token can melt (ordinary tokens always leave an account first).
  const rare = data.accounts.find((a) => a.account === main?.account)?.segments.reduce((t, s) => t + BigInt(s.end) - BigInt(s.start), 0n) ?? 0n;
  const ordinary = main ? (main.balance > rare ? main.balance - rare : 0n) : 0n;
  const min = BigInt(roll.minEntry);
  const parsed = (() => {
    try {
      const n = BigInt(Math.round(Number(amount.replace(/,/g, '')) * 1e6));
      return n > 0n ? n : null;
    } catch {
      return null;
    }
  })();
  const chosen = parsed ?? ordinary;

  return (
    <section className="panel roll-panel">
      <div className="panel-head">
        <h2>Roll an envelope</h2>
        <span className="muted small">{sol(roll.feeLamports)} SOL per roll</span>
      </div>
      <p className="small">
        Seal at least {fmtTokens(min)} ordinary $PROOF into an envelope and roll it. The next Solana block decides whether it
        becomes one of {roll.tiers.length} rare tiers, from {roll.tiers[roll.tiers.length - 1].name} up to {roll.tiers[0].name}, or {roll.fallback.name}.
        You keep the tokens: withdraw them any time (that melts a rolled tier back to ordinary).
      </p>
      <p className="mono small muted">
        Ordinary $PROOF in your main account: {main ? fmtTokens(ordinary) : '…'}
      </p>
      <div className="origin-actions">
        <button className="btn btn-primary" disabled={!main || ordinary < min} onClick={() => { setAmount((ordinary / BASE).toString()); setOpen(true); }}>
          {main && ordinary < min ? `Needs ${fmtTokens(min)} ordinary $PROOF` : 'Seal & roll'}
        </button>
      </div>
      <details className="more-odds">
        <summary className="small">Odds</summary>
        <OddsTable roll={roll} />
      </details>

      {open && (
        <Modal title="Seal & roll" onClose={() => { setOpen(false); setErr(null); }}>
          <label className="field">
            Ordinary $PROOF to seal
            <input value={amount} onChange={(x) => setAmount(x.target.value)} inputMode="decimal" autoFocus />
          </label>
          <p className="small muted">
            Minimum {fmtTokens(min)}, up to {fmtTokens(ordinary)}. One transaction: creates the envelope (about 0.004 SOL rent, returned
            when it is opened) and pays the {sol(roll.feeLamports)} SOL roll fee.
          </p>
          {err && <ErrorNote error={err} />}
          <button
            className="btn btn-primary wide"
            onClick={async () => {
              setErr(null);
              if (chosen < min) return setErr(`Seal at least ${fmtTokens(min)}.`);
              if (chosen > ordinary) return setErr(`You have ${fmtTokens(ordinary)} ordinary $PROOF in your main account.`);
              const sig = await runTx('Seal & roll', () => vault.sealAndRoll(owner, main!.account, chosen));
              if (sig) {
                setOpen(false);
                setRevealing(sig);
              }
            }}
          >
            Seal {fmtTokens(chosen)} & roll · {sol(roll.feeLamports)} SOL
          </button>
        </Modal>
      )}
      {revealing && <RollReveal signature={revealing} onClose={() => setRevealing(null)} />}
    </section>
  );
}

// Envelope button: roll again (Coal or never rolled), for envelopes of ordinary $PROOF only.
export function RollAgain({ e }: { e: Envelope }) {
  const config = useConfig();
  const vault = useVault();
  const [revealing, setRevealing] = useState<string | null>(null);
  const roll = config.roll;
  const eligible = !!roll && e.status === 'sealed' && !e.rolling && !e.ranges.length
    && BigInt(e.common) >= BigInt(roll.minEntry) && !(e.roll && e.roll.points > 0);
  if (!eligible && !revealing) return null;
  return (
    <>
      {eligible && (
        <button className="btn btn-primary" onClick={async () => {
          const sig = await runTx('Roll', () => vault.roll(e.holder, e.address));
          if (sig) setRevealing(sig);
        }}>
          {e.roll ? 'Roll again' : 'Roll'} · {sol(roll!.feeLamports)} SOL
        </button>
      )}
      {revealing && <RollReveal signature={revealing} onClose={() => setRevealing(null)} />}
    </>
  );
}

// Strikes page: every rolled tier, how often it has come up, how many still exist, and recent rolls.
export function RollStats() {
  const config = useConfig();
  const { data } = useApi<Rolls>(config.roll ? '/rolls?limit=12' : null);
  const roll = config.roll;
  if (!roll) return null;
  const winOdds = roll.tiers.reduce((t, x) => t + x.odds, 0);
  const rows = [...roll.tiers, { ...roll.fallback, odds: 1_000_000 - winOdds }];
  const rares = data ? roll.tiers.reduce((t, x) => t + (data.held[x.name]?.count ?? 0), 0) : null;
  return (
    <section className="panel">
      <div className="panel-head panel-head-stack">
        <h2>Rolled tiers</h2>
        <p className="muted list-sub">
          Ordinary $PROOF sealed in an envelope can roll for one of these tiers ({sol(roll.feeLamports)} SOL per roll,{' '}
          {fmtTokens(roll.minEntry)} minimum). No caps: the counts below grow with every roll and shrink when envelopes are withdrawn.{' '}
          <a href="#/wallet">Roll yours</a>
        </p>
      </div>
      {data && (
        <p className="mono small muted">
          {data.total.toLocaleString()} rolls so far · {rares?.toLocaleString()} rolled rares held in envelopes now
        </p>
      )}
      <div className="table-scroll">
      <table className="table odds roll-stats">
        <thead>
          <tr>
            <th>Tier</th><th>Rarity</th><th className="num">Chance</th><th className="num">Rolled</th>
            <th className="num">Exist now</th><th className="num">Listed</th><th className="num">Floor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const h = data?.held[t.name];
            const isFallback = t.name === roll.fallback.name;
            return (
              <tr key={t.name}>
                <td><RollCoin points={t.points} /> {t.name}</td>
                <td className={`t${tier(t.points)}-text`}>{TIER_NAMES[tier(t.points)]}</td>
                <td className="num mono">{odds(t.odds)}</td>
                <td className="num mono">{data ? (data.counts[t.name] ?? 0).toLocaleString() : '…'}</td>
                <td className="num mono">{data ? (h?.count ?? 0).toLocaleString() : '…'}</td>
                <td className="num mono">{isFallback ? '—' : data ? (h?.listed ?? 0) : '…'}</td>
                <td className="num mono">{h?.floor ? <a href="#/desk">{sol(h.floor)} SOL</a> : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <h3 className="roll-recent-head">Latest rolls</h3>
      {!data ? <Loading /> : !data.recent.length ? (
        <p className="muted small">No rolls yet.</p>
      ) : (
        <ul className="feed">
          {data.recent.map((r) => (
            <li key={r.signature} className={r.points > 0 ? 'feed-issue' : 'feed-melt'}>
              <span className="feed-icon" aria-hidden><RollCoin points={r.points} /></span>
              <span className="feed-text">
                <a href={`#/wallet/${r.holder}`}>{short(r.holder)}</a> rolled <strong>{r.name}</strong>
                {r.points > 0 && <span className="muted"> · {TIER_NAMES[tier(r.points)]}</span>}
              </span>
              <a className="feed-link mono small" href={explorer('tx', r.signature)} target="_blank" rel="noreferrer">slot {r.slot}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
