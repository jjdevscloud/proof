// The roll (SPEC §4.5): seal ordinary $PROOF into an envelope, pay a small SOL fee, and the next
// blocks decide which tier it becomes. The browser computes the result itself from the seed block.
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, useApi } from '../api.ts';
import type { Envelope, Health, Rolls, WalletView } from '../api.ts';
import type { RollRules } from '../../../indexer/src/derive.ts';
import { useConfig, useVault } from '../App.tsx';
import { isAddress } from '../chain.ts';
import { BASE, TIER_NAMES, explorer, fmtTokens, short, sol, tier } from '../format.ts';
import { ErrorNote, Loading, Modal, runTx } from './ui.tsx';
import { coinCells } from './pixels.tsx';
import { PixelIcon, rollIconName, shareText } from './TraitIcons.tsx';
import { FilterMenu } from './FilterMenu.tsx';
import { PixelTick } from './PixelTick.tsx';
import { Logo } from './Logo.tsx';

const COIN = coinCells(7, 5, 0);

function RollCoin({ points, spinning = false, name }: { points: number | null; spinning?: boolean; name?: string }) {
  // Each tier's own pixel symbol once the result is known; the plain coin while it spins.
  const icon = !spinning && points !== null ? rollIconName(name) : undefined;
  if (icon) return <span className={`roll-coin roll-icon t${tier(points!)}`} aria-hidden><PixelIcon name={icon} /></span>;
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
  // The same parts as everywhere else: the tier's symbol and name, then its rarity as a dot and word.
  return (
    <span className={`roll-badge-row t${t}`}>
      <RollCoin points={e.roll.points} name={e.roll.name} /><strong>{e.roll.name}</strong>
      <span className="rarity-tag"><i className={`tier-dot t${t}`} />{TIER_NAMES[t]}</span>
    </span>
  );
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
            <td><RollCoin points={t.points} name={t.name} /> {t.name}</td>
            <td className={`t${tier(t.points)}-text`}>{TIER_NAMES[tier(t.points)]}</td>
            <td className="num mono">{t.points}</td>
            <td className="num mono">{odds(t.odds)}</td>
          </tr>
        ))}
        <tr>
          <td><RollCoin points={roll.fallback.points} name={roll.fallback.name} /> {roll.fallback.name}</td>
          <td className={`t${tier(roll.fallback.points)}-text`}>{TIER_NAMES[tier(roll.fallback.points)]}</td>
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
  // The same reveal as a first connect: a white pop-up with the moving border, one square card. While the block is awaited the
  // coin spins and the card trembles; when the result lands it pops in. The result itself is unchanged.
  return (
    <div className="modal-backdrop reveal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal reveal reveal-framed reveal-single" role="dialog" aria-modal="true" aria-label="Your roll">
        <div className="reveal-body">
        {/* DRAFT wording, awaiting Harriet's approval. */}
        <div className="reveal-head">
          <div>
            <h2>{result ? 'Your roll' : 'Rolling'}</h2>
            <p className="muted list-sub">{result ? 'The block has decided.' : 'The next Solana block decides.'}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        {result ? <RollResultCard result={result} /> : (
          <div className="reveal-grid">
            <div className="reveal-card in waiting">
              <div className="reveal-square strike-mini roll-square">
                <Logo />
                <BrandLoader />
                <span className="small muted">{err ? '' : 'Rolling'}</span>
              </div>
            </div>
          </div>
        )}
        {err && <ErrorNote error={err} />}
        {result && (
          <p className="reveal-note">
            {result.points > 0
              ? 'Your envelope now carries this rare tier. List it on the desk, gift it, or keep it. Withdrawing the tokens melts it back to ordinary.'
              : 'Ordinary this time. You can roll the same envelope again from your wallet.'}{' '}
            Worked out in your browser from the seed block. The ledger records it once the block is final, in about 20 seconds.
          </p>
        )}
        <div className="reveal-foot">
          <button className="btn btn-primary" onClick={onClose}>{result ? 'Done' : 'Close'}</button>
        </div>
        </div>
      </div>
    </div>
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
  // The roll as one pop-up, step by step: choose the amount, seal and pay, confirmed, the block decides, the result.
  const [phase, setPhase] = useState<'amount' | 'sign' | 'block' | 'done'>('amount');
  const [result, setResult] = useState<{ name: string; points: number } | null>(null);
  const closeFlow = () => { setOpen(false); setErr(null); setPhase('amount'); setResult(null); };
  // The steps tick one by one, about a second apart, even when the chain answers at once (display only).
  const target = phase === 'amount' ? -1 : phase === 'sign' ? 0 : phase === 'block' ? 2 : 4;
  const [shownAt, setShownAt] = useState(-1);
  useEffect(() => {
    if (target < 0) { setShownAt(-1); return; }
    if (shownAt >= target) return;
    const t = setTimeout(() => setShownAt((n) => n + 1), shownAt < 0 ? 150 : 1000);
    return () => clearTimeout(t);
  }, [target, shownAt]);
  const landed = phase === 'done' && shownAt >= 4;

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

  // The roll, in the frame with the colour cycling border like the 5 rarest Strikes, so it feels like a game.
  // The pop-ups sit outside the frame so they always open above the page.
  return (
    <>
    <section className="feature-frame roll-feature">
    <div className="feature-inner">
      {/* Same title and grey line as the other wallet tabs. The wording is the developer's, cut to two lines. */}
      <div className="view-head">
        <p className="muted view-line">
          Seal at least {fmtTokens(min)} ordinary $PROOF into an envelope and roll it for {sol(roll.feeLamports)} SOL. The next Solana
          block decides the tier. You keep the tokens, and withdrawing them melts the tier.
        </p>
      </div>
      {/* How much can be rolled, large, like the numbers at the top of the page. DRAFT label. */}
      <div className="roll-ready">
        <strong>{main ? fmtTokens(ordinary) : '…'}</strong>
        <span className="muted">Ordinary $PROOF ready to roll</span>
      </div>
      <div className="origin-actions">
        <button className="btn btn-primary" disabled={!main || ordinary < min} onClick={() => { setAmount((ordinary / BASE).toString()); setOpen(true); }}>
          {main && ordinary < min ? `Needs ${fmtTokens(min)} ordinary $PROOF` : 'Seal & roll'}
        </button>
      </div>
    </div>
    </section>

      {open && (
        <div className="modal-backdrop reveal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && (phase === 'amount' || landed) && closeFlow()}>
          <div className="modal reveal reveal-framed reveal-single roll-flow" role="dialog" aria-modal="true" aria-label="Seal and roll">
            <div className="reveal-body">
              {/* DRAFT wording, awaiting Harriet's approval. */}
              <div className="reveal-head">
                <div>
                  <h2>{phase === 'amount' ? 'Seal & roll' : landed ? 'Your roll' : phase === 'sign' ? 'Waiting for your wallet' : 'Rolling'}</h2>
                  <p className="muted list-sub">{landed ? 'The block has decided.' : 'Every step happens here.'}</p>
                </div>
                {(phase === 'amount' || landed) && <button className="icon-btn" onClick={closeFlow} aria-label="Close">×</button>}
              </div>
              <ol className="roll-steps">
                {['Seal and pay', 'Confirmed on Solana', 'The next block decides', 'Your tier'].map((label, n) => {
                  const state = n < shownAt ? 'done' : n === shownAt ? 'now' : 'wait';
                  return (
                    <li key={label} className={`roll-step ${state}`}>
                      <span className="roll-step-mark">{state === 'done' ? <PixelTick /> : state === 'now' ? <BrandLoader /> : n + 1}</span>
                      {label}
                    </li>
                  );
                })}
              </ol>

              {phase === 'amount' && (
                <>
                  <label className="field">
                    Ordinary $PROOF to seal
                    <input value={amount} onChange={(x) => setAmount(x.target.value)} inputMode="decimal" autoFocus />
                  </label>
                  <p className="small muted">
                    Minimum {fmtTokens(min)}, up to {fmtTokens(ordinary)}. One transaction creates the envelope (about 0.004 SOL rent,
                    returned when it is opened) and pays the {sol(roll.feeLamports)} SOL roll fee.
                  </p>
                  {err && <ErrorNote error={err} />}
                  <button
                    className="btn btn-primary wide"
                    onClick={async () => {
              setErr(null);
              if (chosen < min) return setErr(`Seal at least ${fmtTokens(min)}.`);
              if (chosen > ordinary) return setErr(`You have ${fmtTokens(ordinary)} ordinary $PROOF in your main account.`);
              // The ledger runs ~20 s behind the chain. Tokens just bought off the curve are rare but not
              // yet indexed, and would melt if sealed as ordinary: re-check against fresh state first.
              try {
                const [last, health, fresh, wallet] = await Promise.all([
                  vault.lastActivitySlot(main!.account), api<Health>('/health'), vault.mainTokenAccount(owner), api<WalletView>(`/wallet/${owner}`),
                ]);
                if (last > health.syncedSlot) return setErr('Your latest $PROOF transaction is still being indexed (about 20 seconds). Try again in a moment.');
                const rareNow = wallet.accounts.find((x) => x.account === fresh.account)?.segments.reduce((t, x) => t + BigInt(x.end) - BigInt(x.start), 0n) ?? 0n;
                const ordinaryNow = fresh.balance > rareNow ? fresh.balance - rareNow : 0n;
                if (chosen > ordinaryNow) return setErr(`You have ${fmtTokens(ordinaryNow)} ordinary $PROOF in your main account.`);
              } catch (x) {
                return setErr(`Could not check your account: ${(x as Error).message}`);
              }
              // One pop-up for the whole roll, no corner notifications. The same transaction as before.
              setPhase('sign');
              let sig: string;
              try {
                sig = await vault.sealAndRoll(owner, main!.account, chosen);
              } catch (x) {
                setPhase('amount');
                return setErr((x as Error).message ?? String(x));
              }
              setPhase('block');
              try {
                setResult(await vault.rollOutcome(sig));
                setPhase('done');
              } catch (x) {
                setErr((x as Error).message ?? String(x));
              }
                    }}
                  >
                    Seal {fmtTokens(chosen)} & roll · {sol(roll.feeLamports)} SOL
                  </button>
                </>
              )}

              {(phase === 'sign' || phase === 'block' || (phase === 'done' && !landed)) && (
                <div className="reveal-grid">
                  <div className="reveal-card in waiting">
                    <div className="reveal-square strike-mini roll-square">
                      <Logo />
                      <BrandLoader />
                      <span className="small muted">{shownAt <= 0 ? 'Approve it in your wallet' : 'Rolling'}</span>
                    </div>
                  </div>
                  {err && <ErrorNote error={err} />}
                </div>
              )}

              {landed && result && (
                <>
                  <RollResultCard result={result} odds={(() => { const all = [...roll.tiers, { ...roll.fallback, odds: 1_000_000 - roll.tiers.reduce((n, x) => n + x.odds, 0) }]; const hit = all.find((x) => x.name === result.name); return hit ? odds(hit.odds) : undefined; })()} />
                  <p className="reveal-note">
                    {result.points > 0
                      ? 'Your envelope now carries this rare tier. List it on the desk, gift it, or keep it. Withdrawing the tokens melts it back to ordinary.'
                      : 'Ordinary this time. You can roll the same envelope again from your wallet.'}{' '}
                    The ledger records it once the block is final, in about 20 seconds.
                  </p>
                  <div className="reveal-foot">
                    <button className="btn btn-primary" onClick={closeFlow}>Done</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Envelope button: roll again (Coal or never rolled), for envelopes of ordinary $PROOF only.
export function RollAgain({ e }: { e: Envelope }) {
  const config = useConfig();
  const vault = useVault();
  const [revealing, setRevealing] = useState<string | null>(null);
  const roll = config.roll;
  const eligible = !!roll && e.status === 'sealed' && !e.rolling && !(e.ranges ?? []).length
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
// `title` names the panel. `pageHead` makes it a page: the title and its line above the panel, like the
// other page titles, and only the data inside (the Rolls page).
export function RollStats({ title = 'Rolled tiers', pageHead = false }: { title?: string; pageHead?: boolean } = {}) {
  const config = useConfig();
  const { data } = useApi<Rolls>(config.roll ? '/rolls?limit=200' : null);
  const roll = config.roll;
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [tip, setTip] = useState<{ text: string; tier: string; x: number; y: number } | null>(null);
  // The Rolls page search: a tier name or a wallet, and a rarity filter. It narrows the table and the latest rolls.
  const [q, setQ] = useState('');
  const [bands, setBands] = useState<number[]>([]);
  const [names, setNames] = useState<string[]>([]);
  // The key: hovering a rarity picks out its columns in the chart and its rows in the table; a click keeps it.
  const [hover, setHover] = useState<number | null>(null);
  const [pin, setPin] = useState<number | null>(null);
  const focus = hover ?? pin;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [roll]);
  if (!roll) return null;
  const winOdds = roll.tiers.reduce((t, x) => t + x.odds, 0);
  const allRows = [...roll.tiers, { ...roll.fallback, odds: 1_000_000 - winOdds }];
  const query = q.trim().toLowerCase();
  const bandOk = (points: number, name?: string) => (!bands.length || bands.includes(tier(points))) && (!names.length || (name !== undefined && names.includes(name)));
  const rows = allRows.filter((t) => bandOk(t.points, t.name) && (!query || t.name.toLowerCase().includes(query) || TIER_NAMES[tier(t.points)].toLowerCase().includes(query)));
  const searching = !!query || bands.length > 0 || names.length > 0;
  const recentRows = (data?.recent ?? []).filter((r) => bandOk(r.points, r.name) && (!query || r.name.toLowerCase().includes(query) || r.holder.toLowerCase().startsWith(query)));
  const rares = data ? roll.tiers.reduce((t, x) => t + (data.held[x.name]?.count ?? 0), 0) : null;
  const line = (
    <>
      Ordinary $PROOF sealed in an envelope can roll for one of these tiers ({sol(roll.feeLamports)} SOL per roll,{' '}
      {fmtTokens(roll.minEntry)} minimum). No caps: the counts below grow with every roll and shrink when envelopes are withdrawn.{' '}
      <a href="#/wallet">Roll yours</a>
    </>
  );
  const tipBox = tip && (
    <div className="hover-tip" style={{ left: tip.x + 14, top: tip.y + 14 }} aria-hidden>
      <i className={`tip-swatch tip-${tip.tier}`} />
      <span className="tip-body">
        <strong>{tip.text.split('|')[0]}</strong>
        <span>{tip.text.split('|')[1]}</span>
      </span>
    </div>
  );
  const table = (
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
            <tr key={t.name} data-band={tier(t.points)}>
              <td><RollCoin points={t.points} name={t.name} /> {t.name}</td>
              <td><span className="sv-name"><i className={`tier-dot t${tier(t.points)}`} />{TIER_NAMES[tier(t.points)]}</span></td>
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
  );
  const recent = !data ? <Loading /> : !recentRows.length ? (
    <p className="muted small">{data.recent.length ? 'No rolls match.' : 'No rolls yet.'}</p>
  ) : (
    <ul className="feed">
      {recentRows.map((r) => (
        <li key={r.signature} className={r.points > 0 ? 'feed-issue' : 'feed-melt'}>
          <span className="feed-icon" aria-hidden><RollCoin points={r.points} name={r.name} /></span>
          <span className="feed-text">
            <a href={`#/wallet/${r.holder}`}>{short(r.holder)}</a> rolled <strong>{r.name}</strong>
            {r.points > 0 && <span className="muted"> · {TIER_NAMES[tier(r.points)]}</span>}
          </span>
          <a className="feed-link mono small" href={explorer('tx', r.signature)} target="_blank" rel="noreferrer">slot {r.slot}</a>
        </li>
      ))}
    </ul>
  );
  const countLine = data && (
    <p className="mono small muted">
      {data.total.toLocaleString()} rolls so far · {rares?.toLocaleString()} rolled rares held in envelopes now
    </p>
  );
  // Each rarity's share of all rolls so far, for the key.
  const rollShare = (band: number) => {
    if (!data?.total) return '';
    const n = allRows.filter((t) => tier(t.points) === band).reduce((a, t) => a + (data.counts[t.name] ?? 0), 0);
    return shareText(n, data.total);
  };

  if (pageHead) {
    // The Rolls page: the chart in its own tabbed container with a key at the top right, like the Strikes
    // chart, then the tiers table and the latest rolls each in their own container.
    return (
      <div className="roll-page" data-focus={focus ?? undefined}>
        <div className="page-head">
          <div>
            <h1>{title}</h1>
            <p className="muted page-sub">After the curve. Ordinary $PROOF sealed in an envelope can roll for one of these tiers.</p>
          </div>
          {/* The two headline numbers, large, in their own square at the top right. DRAFT labels. */}
          {data && (
            <div className="roll-stat-box">
              <div><strong>{data.total.toLocaleString()}</strong><span className="muted">Rolls so far</span></div>
              <div><strong>{rares?.toLocaleString()}</strong><span className="muted">Rolled rares held now</span></div>
            </div>
          )}
        </div>
        {/* Search, as on the Strikes page: a plain bar under the title. DRAFT wording, awaiting Harriet's approval. */}
        <section className="strike-search top-search">
          <form
            className="search-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (isAddress(q.trim())) location.hash = `#/wallet/${q.trim()}`;
            }}
          >
            <input placeholder="Search all rolls by tier, like Hoard, or by wallet" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tier or wallet" />
            {/* Filters about rolls: the tier rolled, and its rarity, with each one's share of all rolls so far. */}
            <FilterMenu label="Tier" options={allRows.map((t) => ({ value: t.name, label: t.name, mark: rollIconName(t.name) ? <span className={`trait-icon t${tier(t.points)}`}><PixelIcon name={rollIconName(t.name)!} unit={1.5} tight /></span> : undefined, note: data?.total ? shareText(data.counts[t.name] ?? 0, data.total) : '' }))} chosen={names} onToggle={(v) => setNames(names.includes(v) ? names.filter((x) => x !== v) : [...names, v])} />
            <FilterMenu label="Rarity" options={TIER_NAMES.map((n, i) => ({ value: i, label: n, mark: <i className={`tier-dot t${i}`} />, note: rollShare(i) }))} chosen={bands} onToggle={(v) => setBands(bands.includes(v) ? bands.filter((x) => x !== v) : [...bands, v])} />
            <button className="btn btn-primary">Search</button>
          </form>
          {searching && (
            <p className="search-summary">
              <span className="muted">{rows.length} {rows.length === 1 ? 'tier' : 'tiers'} and {recentRows.length} {recentRows.length === 1 ? 'roll' : 'rolls'} match</span>
              <button type="button" className="chip-clear" onClick={() => { setQ(''); setBands([]); setNames([]); }}>Clear all</button>
            </p>
          )}
        </section>
        {/* Not searching: the five newest rolls, in the frame with the colour cycling border. Searching: the
            matches among the latest rolls instead, in a plain container, saying how far back it looked. */}
        {!searching ? (
          <section className="feature-frame">
            <div className="feature-inner">
              <div className="panel-head panel-head-stack">
                {/* DRAFT heading and line, awaiting Harriet's approval. */}
                <h2>Latest rolls</h2>
                <p className="muted list-sub">The newest rolls, as they land on the chain.</p>
              </div>
              {!data ? <Loading /> : !data.recent.length ? <p className="muted small">No rolls yet.</p> : (
                <ul className="strike-feature">
                  {data.recent.slice(0, 5).map((r) => (
                    <li key={r.signature}>
                    {/* Same card as a Strike: symbol top left, tier and wallet beside it, rarity top right, slot at the bottom. */}
                    <header className="post-head">
                      <RollCoin points={r.points} name={r.name} />
                      <span className="post-who">
                        <strong className="strike-title">{r.name}</strong>
                        <a href={`#/wallet/${r.holder}`} className="small muted">{short(r.holder)}</a>
                      </span>
                      <span className="rarity-tag"><i className={`tier-dot t${tier(r.points)}`} />{TIER_NAMES[tier(r.points)]}</span>
                    </header>
                    <a className="small muted card-foot-line" href={explorer('tx', r.signature)} target="_blank" rel="noreferrer">Slot {r.slot}</a>
                  </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ) : (
          <section className="panel">
            <div className="panel-head panel-head-stack">
              <h2>{recentRows.length} {recentRows.length === 1 ? 'roll' : 'rolls'} found</h2>
              <p className="muted list-sub">Matching your search among the latest {data?.recent.length ?? 0} rolls, newest first.</p>
            </div>
            {!data ? <Loading /> : !recentRows.length ? <p className="muted small">No rolls match.</p> : (
              <ul className="strike-feature">
                {recentRows.slice(0, 40).map((r) => (
                  <li key={r.signature}>
                    {/* Same card as a Strike: symbol top left, tier and wallet beside it, rarity top right, slot at the bottom. */}
                    <header className="post-head">
                      <RollCoin points={r.points} name={r.name} />
                      <span className="post-who">
                        <strong className="strike-title">{r.name}</strong>
                        <a href={`#/wallet/${r.holder}`} className="small muted">{short(r.holder)}</a>
                      </span>
                      <span className="rarity-tag"><i className={`tier-dot t${tier(r.points)}`} />{TIER_NAMES[tier(r.points)]}</span>
                    </header>
                    <a className="small muted card-foot-line" href={explorer('tx', r.signature)} target="_blank" rel="noreferrer">Slot {r.slot}</a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <div className="tabs" role="tablist" aria-label="View">
          {/* DRAFT tab label, awaiting Harriet's approval. */}
          <button type="button" role="tab" aria-selected className="tab on">Rolled tiers</button>
        </div>
        <section className="panel tabbed">
          <div className="view-head">
            <div className="muted view-line" />
            <div className="legend small key-interactive">
              <span className="key-hint">Filter</span>
              {TIER_NAMES.map((n, i) => (
                <button
                  key={n}
                  type="button"
                  className={focus === i ? 'key-item on' : 'key-item'}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => setPin(pin === i ? null : i)}
                  aria-pressed={focus === i}
                >
                  <i className={`swatch t${i}`} />{n}{rollShare(i) && <span className="key-share">{rollShare(i)}</span>}
                </button>
              ))}
              <span className="key-item"><i className="swatch melted-swatch" />Withdrawn</span>
              <span className="key-item"><i className="swatch unissued-swatch" />Not rolled yet</span>
            </div>
          </div>
          <div className="roll-curve-box" ref={box}>
            {w > 0 && <RollCurve roll={roll} data={data} width={w} onTip={setTip} />}
          </div>
          {tipBox}
        </section>
        <section className="panel">
          <div className="panel-head panel-head-stack">
            {/* DRAFT heading and line, awaiting Harriet's approval. */}
            <h2>Odds by tier</h2>
            <p className="muted list-sub">How many of each have been rolled, how many still exist, and the lowest price on the desk.</p>
          </div>
          {table}
        </section>
      </div>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head panel-head-stack">
        <h2>{title}</h2>
        <p className="muted list-sub">{line}</p>
      </div>
      {countLine}
      <div className="roll-curve-box" ref={box}>
        {w > 0 && <RollCurve roll={roll} data={data} width={w} onTip={setTip} />}
      </div>
      {tipBox}
      {table}
      <h3 className="roll-recent-head">Latest rolls</h3>
      {recent}
    </section>
  );
}

// Pixel chart in the style of the bonding-curve view: tiers from the fallback (left) to the rarest
// (right), each column as tall as the tier is rare (log of its odds). Lit cells: share of that tier
// ever rolled that still exists; grey: withdrawn (melted); outlined: never rolled yet.
export function RollCurve({ roll, data, width, onTip }: {
  roll: RollRules;
  data: Rolls | null;
  width: number;
  onTip: (t: { text: string; tier: string; x: number; y: number } | null) => void;
}) {
  const W = Math.max(300, Math.round(width));
  const H = 300;
  const cell = 10;
  const gap = 2;
  const pitch = cell + gap;
  const base = H - 26;
  const winOdds = roll.tiers.reduce((t, x) => t + x.odds, 0);
  const tiers = [{ ...roll.fallback, odds: 1_000_000 - winOdds }, ...[...roll.tiers].reverse()];
  const columns = Math.floor(W / pitch);
  const band = Math.max(1, Math.floor(columns / tiers.length) - 1);
  const headroom = Math.ceil(pitch * 1.4) + 22;
  const maxRows = Math.floor((base - headroom) / pitch);
  const rarity = (odds: number) => Math.log10(1_000_000 / Math.max(1, odds));
  const top = rarity(Math.min(...tiers.map((t) => t.odds)));
  const rowsOf = (odds: number) => Math.max(2, Math.round(2 + (maxRows - 2) * (rarity(odds) / top) ** 1.15));
  const stride = band + 1;
  const offset = Math.floor((columns - stride * tiers.length + 1) / 2) * pitch;
  const rects: ReactNode[] = [];
  const labels: ReactNode[] = [];
  const tops: [number, number][] = [];
  tiers.forEach((t, i) => {
    const rolled = data?.counts[t.name] ?? 0;
    const h = data?.held[t.name];
    const exist = h?.count ?? 0;
    const rows = rowsOf(t.odds);
    const total = rows * band;
    const lit = rolled ? Math.max(exist ? 1 : 0, Math.round((total * exist) / rolled)) : 0;
    const tr = tier(t.points);
    const tip = `${t.name} · ${TIER_NAMES[tr]}|${odds(t.odds)} chance · ${rolled.toLocaleString()} rolled · ${exist.toLocaleString()} exist now`
      + (h?.listed ? ` · ${h.listed} listed, floor ${sol(h.floor!)} SOL` : '');
    const x0 = offset + i * stride * pitch;
    let n = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < band; c++) {
        const cls = !rolled ? 'rc-none' : n < lit ? (tr === 0 ? 'rc-coal' : `lab-t${tr}`) : 'rc-gone';
        rects.push(<rect key={`${i},${r},${c}`} className={cls} x={x0 + c * pitch} y={base - (r + 1) * pitch} width={cell} height={cell} data-tip={tip} data-tier={!rolled ? 'u' : tr === 0 ? 'm' : tr} data-band={tr} />);
        n++;
      }
    }
    const cx = x0 + (band * pitch - gap) / 2;
    tops.push([cx, base - rows * pitch - pitch * 1.2]);
    if (data) labels.push(<text key={`n${i}`} x={cx} y={base - rows * pitch - 6} textAnchor="middle" className="lab-muted">{exist.toLocaleString()}</text>);
    if (band * pitch >= 70) labels.push(<text key={`l${i}`} x={cx} y={base + 18} textAnchor="middle">{t.name.toUpperCase()}</text>);
  });
  const path = tops.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${(y - 10).toFixed(1)}`).join(' ');
  const [tx, ty] = tops[tops.length - 1];
  const [px, py] = tops[tops.length - 2];
  const angle = Math.atan2(ty - py, tx - px);
  const head = [0.5, -0.5].map((d) => `${tx - 7 * Math.cos(angle + d)},${ty - 10 - 7 * Math.sin(angle + d)}`).join(' ');
  return (
    <svg
      className="lab-svg roll-curve"
      viewBox={`0 0 ${W} ${H}`}
      shapeRendering="crispEdges"
      onMouseMove={(e) => {
        const el = (e.target as Element).closest('[data-tip]');
        onTip(el ? { text: el.getAttribute('data-tip')!, tier: el.getAttribute('data-tier') ?? '', x: e.clientX, y: e.clientY } : null);
      }}
      onMouseLeave={() => onTip(null)}
    >
      {rects}
      {labels}
      <path className="lab-arrow" d={path} shapeRendering="geometricPrecision" />
      <polygon className="lab-arrowhead" points={`${tx},${ty - 10} ${head}`} shapeRendering="geometricPrecision" />
      {band * pitch < 70 && (
        <>
          <text x={offset} y={base + 18}>{tiers[0].name.toUpperCase()}</text>
          <text x={offset + (tiers.length * stride - 1) * pitch} y={base + 18} textAnchor="end">{tiers[tiers.length - 1].name.toUpperCase()}</text>
        </>
      )}
    </svg>
  );
}

// A loader in the four rarity colours: green, blue, purple, black, stepping one after another.
export function BrandLoader() {
  return <span className="brand-loader" aria-hidden><i className="t0" /><i className="t1" /><i className="t2" /><i className="t3" /></span>;
}

// Pixel confetti in the four rarity colours, bursting from behind a card. None for Common, more the rarer it is.
export function Confetti({ points }: { points: number }) {
  const t = tier(points);
  // No confetti for Common. Uncommon, Rare and Legendary get more the rarer they are.
  if (t === 0) return null;
  const n = [0, 22, 40, 64][t];
  const pieces = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
    const d = 140 + Math.random() * 160;
    return {
      key: i,
      style: {
        '--dx': `${Math.cos(a) * d}px`,
        '--dy': `${Math.sin(a) * d * 0.7 - 40}px`,
        '--rot': `${Math.round(Math.random() * 540 - 270)}deg`,
        '--delay': `${Math.random() * 0.15}s`,
        '--size': `${4 + Math.round(Math.random() * 4)}px`,
      } as React.CSSProperties,
      // Uncommon is all blue, Rare all purple, Legendary uses every rarity colour.
      tone: t === 3 ? `t${i % 4}` : `t${t}`,
    };
  });
  return <div className="confetti" aria-hidden>{pieces.map((p) => <i key={p.key} className={p.tone} style={p.style} />)}</div>;
}

// The result of a roll as one square card: the tier symbol large, its name, its rarity and points, its odds.
function RollResultCard({ result, odds: chance }: { result: { name: string; points: number }; odds?: string }) {
  const t = tier(result.points);
  return (
    <div className="roll-result-wrap">
      <Confetti points={result.points} />
      <div className="reveal-card in landed">
        <div className={`reveal-square strike-mini roll-square roll-result t${t}`}>
          <RollCoin points={result.points} name={result.name} />
          <strong className="roll-result-name">{result.name}</strong>
          <span className="roll-result-meta">
            <span className="rarity-tag"><i className={`tier-dot t${t}`} />{TIER_NAMES[t]}</span>
            <span className="muted">{result.points} points</span>
          </span>
          {chance && <span className="small muted">{chance} chance per roll</span>}
        </div>
      </div>
    </div>
  );
}
