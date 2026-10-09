import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../api.ts';
import type { Envelope, Preview, Segment, WalletView } from '../api.ts';
import { useConfig, useVault } from '../App.tsx';
import { isAddress, useWallet } from '../chain.ts';
import { BASE, CLUSTER, TIER_NAMES, feeOf, feePct, fmtTokens, lamportsFromSol, short, sol, tier } from '../format.ts';
import { Addr, ErrorNote, Loading, Modal, SegmentList, StrikeCardView, StrikeCoin, Traits, TypedConfirm, runTx } from '../components/ui.tsx';
import { RollAgain, RollPanel } from '../components/Roll.tsx';
import { EnvelopeDetails, EnvelopePic } from './Desk.tsx';
import { VerifyBox } from '../components/Closer.tsx';

// While the reveal is being reviewed, show it on every connect (true). Once approved: false, first connect only.
const REVEAL_EVERY_TIME = true;

export function WalletPage({ address: routeAddress }: { address: string | null }) {
  const wallet = useWallet();
  const address = routeAddress ?? wallet.address;
  const [tab, setTab] = useState<'rare' | 'envelopes' | 'roll'>('rare');
  const valid = !!address && isAddress(address);
  const { data, error } = useApi<WalletView>(valid ? `/wallet/${address}` : null);
  const own = !!address && address === wallet.address;
  // Ordinary $PROOF in your main account, for the tally at the top: the account balance less its rare
  // tokens (read only, the same reading the Roll tab uses).
  const vault = useVault();
  const [main, setMain] = useState<{ account: string; balance: bigint } | null>(null);
  useEffect(() => {
    if (!own || !address) return;
    let live = true;
    vault.mainTokenAccount(address).then((m) => live && setMain(m)).catch(() => live && setMain(null));
    return () => {
      live = false;
    };
  }, [vault, own, address, data]);

  // The reveal: the first time a wallet connects, everything it holds is revealed one by one. After that,
  // only what is new since the last visit. What has been seen is kept in this browser only (display only).
  const [reveal, setReveal] = useState<{ strikes: Segment[]; first: boolean } | null>(null);
  const revealChecked = useRef<string | null>(null);
  useEffect(() => {
    if (!own || !address || !data || revealChecked.current === address) return;
    revealChecked.current = address;
    const key = `sequents-seen:${address}`;
    let seen: string[] | null = null;
    try { seen = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { seen = null; }
    // PREVIEW: while Harriet reviews the reveal it plays on every connect. Set REVEAL_EVERY_TIME to false once approved.
    if (REVEAL_EVERY_TIME) seen = null;
    const strikes = data.accounts.flatMap((a) => a.segments);
    const newStrikes = seen ? strikes.filter((x) => !seen!.includes(`s${x.start}`)) : strikes;
    // Only Strikes are revealed: on a first connect they are what you bought off the curve. Envelopes come later.
    try { localStorage.setItem(key, JSON.stringify(strikes.map((x) => `s${x.start}`))); } catch { /* private mode: no memory, no harm */ }
    if (newStrikes.length) setReveal({ strikes: newStrikes, first: !seen });
  }, [own, address, data]);

  if (!address && wallet.restoring) return <Loading what="Reconnecting your wallet" />;
  if (!address) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>My wallet</h1>
            {/* DRAFT line, awaiting Harriet's approval. */}
            <p className="muted page-sub">Connect your wallet to see and manage your rare $PROOF.</p>
          </div>
        </div>
        {/* Connecting is the one action here. Looking up someone else's wallet lives in Verify holdings on the Overview. */}
        <section className="feature-frame wallet-connect-frame">
          <div className="feature-inner wallet-connect">
            {/* DRAFT heading and lines, awaiting Harriet's approval. */}
            <h2>Connect your wallet</h2>
            <p className="muted list-sub">See what you got: the rare tokens you bought on the curve and your envelopes. Then seal, list, gift or roll.</p>
            <button className="btn btn-primary btn-cycle" onClick={() => wallet.connect().catch(() => {})} disabled={!wallet.available}>
              {wallet.available ? 'Connect wallet' : 'No wallet detected'}
            </button>
          </div>
        </section>
        {/* Looking at someone else's wallet: the same Verify holdings box as on the Overview, full width. */}
        <div className="wallet-verify"><VerifyBox /></div>
      </>
    );
  }
  if (!valid) return <ErrorNote error="That doesn't look like a Solana address." />;

  const segmentsTotal = (data?.accounts ?? []).reduce((n, a) => n + a.segments.length, 0);

  const mainRare = data?.accounts.find((a) => a.account === main?.account)?.segments.reduce((t, x) => t + BigInt(x.end) - BigInt(x.start), 0n) ?? 0n;
  const ordinaryTokens = main ? (main.balance > mainRare ? main.balance - mainRare : 0n) : 0n;
  const rareTokens = (data?.accounts ?? []).reduce((n, a) => n + a.segments.reduce((t, x) => t + BigInt(x.end) - BigInt(x.start), 0n), 0n);
  return (
    <>
      {reveal && <Reveal {...reveal} onDone={() => setReveal(null)} />}
      <div className="page-head">
        <div>
          <h1>{own ? 'My wallet' : 'Wallet'}</h1>
          {/* DRAFT line, awaiting Harriet's approval. */}
          <p className="muted page-sub"><Addr value={address} />{own ? ' is currently connected.' : ', viewing only, not connected.'} Rare tokens from the curve and sealed envelopes.</p>
        </div>
        {data && (
          <div className="roll-stat-box">
            {own && <div><strong>{main ? fmtTokens(ordinaryTokens) : '…'}</strong><span className="muted">Ordinary $PROOF</span></div>}
            <div><strong>{fmtTokens(rareTokens)}</strong><span className="muted">Rare tokens</span></div>
            <div><strong>{data.envelopes.length}</strong><span className="muted">Envelopes</span></div>
          </div>
        )}
      </div>
      <div className="tabs" role="tablist" aria-label="Wallet">
        {(own ? (['rare', 'envelopes', 'roll'] as const) : (['rare', 'envelopes'] as const)).map((v) => (
          <button key={v} role="tab" aria-selected={tab === v} className={`${tab === v ? 'tab on' : 'tab'}${v === 'roll' ? (tab === v ? ' tab-roll' : ' tab-roll-idle') : ''}`} onClick={() => setTab(v)}>
            {v === 'rare' ? `Rare tokens (${segmentsTotal})` : v === 'envelopes' ? `Envelopes (${data?.envelopes.length ?? 0})` : 'Roll'}
          </button>
        ))}
      </div>
      {own && CLUSTER === 'devnet' && <DevnetTokens address={address} />}
      {error && <ErrorNote error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          {tab === 'roll' && own && <RollPanel owner={address} data={data} />}
          {tab === 'rare' && <section className="panel tabbed">
            {/* Like the Strikes chart tab: the tab names it, a grey line top left says what it is. DRAFT line. */}
            <div className="view-head">
              <p className="muted view-line">Rare tokens stay rare while they stay in the account that bought them. Select Strikes to seal them into an envelope.</p>
            </div>
            {!data.accounts.length ? (
              <p className="muted">
                {own ? 'You hold no rare $PROOF outside envelopes. ' : 'No rare $PROOF here. '}
                Rarity only exists in the account that bought it off the curve. Tokens bought after the curve or received from others are ordinary.
              </p>
            ) : (
              data.accounts.map((a) => <OriginAccount key={a.account} owner={address} account={a.account} common={a.common} segments={a.segments} own={own} />)
            )}
          </section>}

          {tab === 'envelopes' && <section className="panel tabbed">
            <div className="view-head">
              {/* DRAFT line, awaiting Harriet's approval. */}
              <p className="muted view-line">Sealed tokens that can be listed, gifted or rolled without melting.</p>
            </div>
            {!data.envelopes.length ? (
              <p className="muted">{own ? 'Seal rare tokens into an envelope to sell or gift them without melting.' : 'No envelopes.'}</p>
            ) : (
              <div className="cards wallet-envelopes">
                {data.envelopes.map((e) => <EnvelopeCard key={e.address} envelope={e} own={own} />)}
              </div>
            )}
          </section>}
        </>
      )}
    </>
  );
}

function OriginAccount({ owner, account, common, segments, own }: { owner: string; account: string; common: string; segments: Segment[]; own: boolean }) {
  const vault = useVault();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sealing, setSealing] = useState(false);
  const chosen = segments.filter((s) => selected.has(s.start));
  const chosenTotal = chosen.reduce((t, s) => t + BigInt(s.end) - BigInt(s.start), 0n);
  const toggle = (start: string) => {
    const next = new Set(selected);
    next.has(start) ? next.delete(start) : next.size < 8 && next.add(start);
    setSelected(next);
  };

  return (
    <div className="origin">
      {/* Which token account (the "pocket" your wallet keeps $PROOF in) holds these Strikes, small at the top right,
          with an info icon that explains it. DRAFT wording, awaiting Harriet's approval. */}
      <div className="origin-head">
        <span className="origin-acct">
          <span className="muted">Token account</span> <Addr value={account} />
          <AccountInfo common={common} />
        </span>
      </div>
      {/* Each Strike as its own card, like the envelopes: picture top left, number and rarity, then the traits,
          range and amount. Your own: click a card (or its tick box) to select it for sealing. */}
      <div className="cards wallet-envelopes token-cards">
        {segments.map((s) => {
          const amount = BigInt(s.end) - BigInt(s.start);
          const on = selected.has(s.start);
          return (
            <article
              key={s.start}
              className={`card post token-card${on ? ' selected' : ''}${own ? ' selectable' : ''}`}
              onClick={own ? (ev) => { if (!(ev.target as Element).closest('a, input')) toggle(s.start); } : undefined}
            >
              <StrikeCardView
                strike={s.strike}
                rank={s.rank}
                traits={s.traits}
                part={amount}
                whole={1_000_000_000_000n}
                sub={`${fmtTokens(amount)} tokens`}
                extra={own && <input type="checkbox" checked={on} onChange={() => toggle(s.start)} aria-label={`Select Strike #${s.strike}`} />}
              />
            </article>
          );
        })}
      </div>
      {own && (
        <div className="origin-actions">
          <button className="btn btn-primary" disabled={!chosen.length} onClick={() => setSealing(true)}>
            {chosen.length ? `Seal ${chosen.length} selected into an envelope` : 'Select strikes to seal'}
          </button>
          <SellPreview account={account} />
        </div>
      )}
      {sealing && (
        <Modal title="Seal into an envelope" onClose={() => setSealing(false)}>
          <SegmentList segments={chosen} />
          <p className="small">
            Moves exactly these {fmtTokens(chosenTotal)} tokens into a new envelope that only you control. Their rarity stays intact,
            and you can then list, gift or keep the envelope. Creating it costs about 0.004 SOL of rent, returned when it is opened.
          </p>
          <button
            className="btn btn-primary wide"
            onClick={async () => {
              const sig = await runTx('Seal', () => vault.seal(owner, account, chosen.map((s) => ({ start: BigInt(s.start), end: BigInt(s.end) }))));
              if (sig) {
                setSealing(false);
                setSelected(new Set());
              }
            }}
          >
            Seal {chosen.length} strike{chosen.length === 1 ? '' : 's'}
          </button>
        </Modal>
      )}
    </div>
  );
}

// The i beside a token account. Hover or focus shows a small black label, like the coin labels on the Rules
// page: what a token account is, and the ordinary $PROOF it also holds. DRAFT wording.
function AccountInfo({ common }: { common: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="info-wrap" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className="info-dot" tabIndex={0} onFocus={() => setShow(true)} onBlur={() => setShow(false)} aria-label="What is a token account?">i</span>
      {show && (
        <span className="hover-tip info-tip" role="tooltip">
          <span className="tip-body">
            <strong>Token account</strong>
            <span>Where your wallet keeps $PROOF. Rarity stays in the token account that bought it off the curve.</span>
            {BigInt(common) > 0n && <span>Also holds {fmtTokens(common)} ordinary $PROOF, which leave first.</span>}
          </span>
        </span>
      )}
    </span>
  );
}

// "If I sell or send N tokens from this account, what melts?" Under each account, beside Seal. A click turns
// the button into a small search bar in the same place; the answer shows in a box under the account, in
// two columns. The check itself is unchanged: it asks the indexer's /preview.
function SellPreview({ account }: { account: string }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [res, setRes] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setErr(null);
    setRes(null);
    try {
      const n = BigInt(Math.round(Number(amount.replace(/,/g, '')) * 1e6));
      if (n <= 0n) throw new Error('Enter an amount');
      setRes(await api<Preview>(`/preview?account=${account}&amount=${n}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!open) return <button className="btn btn-ghost" onClick={() => setOpen(true)}>What melts if I sell?</button>;
  return (
    <>
      <form className="search-row melt-bar" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <input placeholder="Tokens to sell or send" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Amount" autoFocus />
        <button className="btn btn-primary">Check</button>
        <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setRes(null); setErr(null); }} aria-label="Close">Close</button>
      </form>
      {err && <div className="melt-box"><ErrorNote error={err} /></div>}
      {res && (
        <div className="melt-box melt-result">
          <div>
            <span className="muted">Leaves first</span>
            <strong>{fmtTokens(res.fromMelted)}</strong>
            <span className="muted">ordinary tokens</span>
          </div>
          <div>
            {res.segments.length ? (
              <>
                <span className="melt-word">Then these rare tokens would melt</span>
                <SegmentList segments={res.segments} />
                <span className="muted">To sell rare tokens without melting them, seal them and list the envelope on the desk.</span>
              </>
            ) : (
              <span className="ok-word">No rare tokens would melt.</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function EnvelopeCard({ envelope: e, own }: { envelope: Envelope; own: boolean }) {
  const vault = useVault();
  const config = useConfig();
  const [mode, setMode] = useState<null | 'list' | 'gift' | 'withdraw'>(null);
  const [price, setPrice] = useState('');
  const [to, setTo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const close = () => {
    setMode(null);
    setErr(null);
  };

  return (
    <article className="card post wallet-env">
      {/* The same card as on the desk: the envelope picture top left, its status and price, then what is inside. */}
      <EnvelopeHead e={e} />
      <EnvelopeDetails envelope={e} showAddress={false} />
      {own && (
        <div className="card-foot">
          {e.status === 'listed' ? (
            <button className="btn btn-ghost" onClick={() => runTx('Cancel listing', () => vault.cancel(e.holder, e.address))}>Cancel listing</button>
          ) : (
            <>
              <RollAgain e={e} />
              <button className={e.roll?.points || e.segments.length ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setMode('list')}>List on desk</button>
              <button className="btn btn-ghost" onClick={() => setMode('gift')}>Gift</button>
              <button className="btn btn-ghost danger-text" onClick={() => setMode('withdraw')}>Withdraw…</button>
            </>
          )}
        </div>
      )}

      {mode === 'list' && (
        <Modal title="List on the collector desk" onClose={close}>
          <div className="post buy-post"><EnvelopeHead e={e} /><EnvelopeDetails envelope={e} showAddress={false} /></div>
          <label className="field">
            Price in SOL
            <input value={price} onChange={(x) => setPrice(x.target.value)} inputMode="decimal" placeholder="e.g. 1.5" autoFocus />
          </label>
          {/* The same facts as before, as a labelled list like the buy pop-up. DRAFT wording. */}
          <dl className="post-details buy-terms">
            <dt>You get</dt>
            <dd>
              {(() => {
                try {
                  const l = lamportsFromSol(price);
                  return l > 0n ? <strong>{sol(l - feeOf(l, config.feeBps))} SOL</strong> : 'The price';
                } catch {
                  return 'The price';
                }
              })()}
              , after the {feePct(config.feeBps)} Sequents desk fee
            </dd>
            <dt>How</dt><dd className="muted">The envelope stays in the vault. A buyer pays and becomes the holder in one transaction.</dd>
          </dl>
          {err && <ErrorNote error={err} />}
          <button
            className="btn btn-primary wide"
            onClick={async () => {
              try {
                const lamports = lamportsFromSol(price);
                if (lamports <= 0n) throw new Error('Price must be above zero');
                if (await runTx('List', () => vault.list(e.holder, e.address, lamports))) close();
              } catch (x) {
                setErr((x as Error).message);
              }
            }}
          >
            List for {price || '…'} SOL
          </button>
        </Modal>
      )}

      {mode === 'gift' && (
        <Modal title="Gift this envelope" onClose={close}>
          <div className="post buy-post"><EnvelopeHead e={e} /><EnvelopeDetails envelope={e} showAddress={false} /></div>
          <label className="field">
            Recipient wallet address
            <input value={to} onChange={(x) => setTo(x.target.value.trim())} placeholder="Solana address" autoFocus spellCheck={false} />
          </label>
          <p className="small muted">The recipient becomes the holder immediately. This cannot be undone.</p>
          {to && !isAddress(to) && <ErrorNote error="Not a valid address." />}
          <TypedConfirm
            word="GIFT"
            label={`Gift to ${short(to) || '…'}`}
            danger={false}
            onConfirm={async () => {
              if (isAddress(to) && (await runTx('Gift', () => vault.gift(e.holder, e.address, to)))) close();
            }}
          />
        </Modal>
      )}

      {mode === 'withdraw' && (
        <Modal title="Withdraw and melt" onClose={close}>
          <p className="melt-banner">
            Withdrawing sends the tokens back to your wallet as <strong>ordinary $PROOF</strong>. Their rarity is destroyed permanently.
            No one can ever restore it.
          </p>
          <div className="post buy-post"><EnvelopeHead e={e} /><EnvelopeDetails envelope={e} showAddress={false} /></div>
          <TypedConfirm word="MELT" label="Withdraw and melt forever" onConfirm={async () => {
            if (await runTx('Withdraw', () => vault.withdraw(e.holder, e.address, e.vault))) close();
          }} />
        </Modal>
      )}
    </article>
  );
}

// DEVNET ONLY: lets testers get rare positions straight off the mock curve.
function DevnetTokens({ address }: { address: string }) {
  const vault = useVault();
  const [busy, setBusy] = useState(false);
  const buy = async (n: bigint) => {
    setBusy(true);
    await runTx(`Get ${n.toLocaleString()} test tokens`, () => vault.devnetCurveBuy(address, n));
    setBusy(false);
  };
  return (
    <section className="panel devnet">
      <div className="panel-head">
        <h2>Devnet testing</h2>
        <span className="pill">devnet only</span>
      </div>
      <p className="small muted">
        Buy free test $PROOF straight off the test curve. They arrive as fresh, numbered tokens in your main token account,
        so they keep their rarity. They show up below about 30 seconds after the block is finalized. You need a little devnet SOL
        for fees (faucet.solana.com).
      </p>
      <div className="hero-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => buy(1_000_000n)}>Get 1,000,000 (one Strike)</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => buy(2_500_000n)}>Get 2,500,000</button>
      </div>
    </section>
  );
}

// An envelope's header, the same in its card and in its pop-ups: the large envelope picture top left, its name
// and status beside it, the price top right when listed.
function EnvelopeHead({ e }: { e: Envelope }) {
  return (
    <header className="post-head">
      <EnvelopePic envelope={e} />
      <span className="post-who">
        <strong>Envelope {short(e.address)}</strong>
        <span className="small muted">{e.status === 'listed' ? 'Listed on the desk' : 'Sealed'}</span>
      </span>
      {e.status === 'listed' && <span className="price">{sol(e.price)} <small>SOL</small></span>}
    </header>
  );
}

// The reveal pop-up: a white pop-up edged with the moving four colour border, each Strike pops in as a square card one after another,
// least rare first, with a little shake; the rarest lands last in the moving frame. Once all are out it holds a
// stays open until See my wallet is clicked (Skip shows them all at once). Display only.
function Reveal({ strikes, first, onDone }: { strikes: Segment[]; first: boolean; onDone: () => void }) {
  const items = [...strikes].sort((a, b) => a.rank - b.rank);
  const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(still ? items.length : 0);
  const done = shown >= items.length;
  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 600 : 900);
    return () => clearTimeout(t);
  }, [shown, done, onDone]);
  return (
    <div className="modal-backdrop reveal-backdrop">
      <div className="modal reveal reveal-framed" role="dialog" aria-modal="true" aria-label="Your reveal">
        <div className="reveal-body">
        {/* DRAFT wording, awaiting Harriet's approval. */}
        <div className="reveal-head">
          <div>
            <h2>{first ? 'See what you got' : 'New since your last visit'}</h2>
            <p className="muted list-sub">{first ? 'Your Strikes from the curve, least rare first.' : 'Strikes added since you were last here.'}</p>
          </div>
          <span className="muted">{Math.min(shown, items.length)} of {items.length}</span>
        </div>
        <div className="reveal-grid">
          {items.map((x, i) => {
            const amount = BigInt(x.end) - BigInt(x.start);
            const rarest = i === items.length - 1 && items.length > 1;
            const card = (
              <div className="reveal-square strike-mini">
                <StrikeCardView strike={x.strike} rank={x.rank} traits={x.traits} part={amount} whole={1_000_000_000_000n} sub={`${fmtTokens(amount)} tokens`} />
              </div>
            );
            return (
              <div key={x.start} className={`reveal-card${i < shown ? ' in' : ''}${rarest ? ' rarest' : ''}`}>
                {rarest ? <div className="feature-frame">{card}</div> : card}
              </div>
            );
          })}
        </div>
        <div className="reveal-foot">
          {!done && <button className="btn btn-ghost" onClick={() => setShown(items.length)}>Skip</button>}
          <button className="btn btn-primary" onClick={onDone}>See my wallet</button>
        </div>
        </div>
      </div>
    </div>
  );
}
