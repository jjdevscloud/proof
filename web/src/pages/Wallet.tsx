import { useState } from 'react';
import { api, useApi } from '../api.ts';
import type { Envelope, Preview, Segment, WalletView } from '../api.ts';
import { useVault } from '../App.tsx';
import { isAddress, useWallet } from '../chain.ts';
import { BASE, CLUSTER, fmtTokens, lamportsFromSol, short, sol } from '../format.ts';
import { Addr, ErrorNote, Loading, Modal, SegmentList, StrikeCoin, Traits, TypedConfirm, runTx } from '../components/ui.tsx';

export function WalletPage({ address: routeAddress }: { address: string | null }) {
  const wallet = useWallet();
  const address = routeAddress ?? wallet.address;
  const [input, setInput] = useState('');
  const valid = !!address && isAddress(address);
  const { data, error } = useApi<WalletView>(valid ? `/wallet/${address}` : null);
  const own = !!address && address === wallet.address;

  if (!address && wallet.restoring) return <Loading what="Reconnecting your wallet" />;
  if (!address) {
    return (
      <div className="panel narrow">
        <h1>Your rare tokens</h1>
        <p className="muted">Connect your wallet to see and manage your rare $PROOF, or look up any address.</p>
        <button className="btn btn-primary" onClick={() => wallet.connect().catch(() => {})} disabled={!wallet.available}>
          {wallet.available ? 'Connect wallet' : 'No wallet detected'}
        </button>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (isAddress(input.trim())) location.hash = `#/wallet/${input.trim()}`; }}>
          <input placeholder="Or paste a wallet address" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Wallet address" />
          <button className="btn btn-ghost">Look up</button>
        </form>
      </div>
    );
  }
  if (!valid) return <ErrorNote error="That doesn't look like a Solana address." />;

  const segmentsTotal = (data?.accounts ?? []).reduce((n, a) => n + a.segments.length, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{own ? 'My wallet' : 'Wallet'}</h1>
          <p className="mono small muted"><Addr value={address} /> {own && <span className="pill">connected</span>}</p>
        </div>
      </div>
      {own && CLUSTER === 'devnet' && <DevnetTokens address={address} />}
      {error && <ErrorNote error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Rare tokens in origin accounts</h2>
              <span className="muted small">{segmentsTotal ? 'Safe while they stay put' : ''}</span>
            </div>
            {!data.accounts.length ? (
              <p className="muted">
                {own ? 'You hold no rare $PROOF outside envelopes. ' : 'No rare $PROOF here. '}
                Rarity only exists in the account that bought it off the curve — tokens bought on Jupiter or received from others are ordinary.
              </p>
            ) : (
              data.accounts.map((a) => <OriginAccount key={a.account} owner={address} account={a.account} common={a.common} segments={a.segments} own={own} />)
            )}
          </section>

          <section className="panel">
            <h2>Envelopes</h2>
            {!data.envelopes.length ? (
              <p className="muted">{own ? 'Seal rare tokens into an envelope to sell or gift them without melting.' : 'No envelopes.'}</p>
            ) : (
              <div className="cards">
                {data.envelopes.map((e) => <EnvelopeCard key={e.address} envelope={e} own={own} />)}
              </div>
            )}
          </section>
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
      <div className="origin-head small muted">
        Token account <Addr value={account} />
        {BigInt(common) > 0n && <> · plus {fmtTokens(common)} ordinary $PROOF (these leave first)</>}
      </div>
      <ul className="segments selectable">
        {segments.map((s) => (
          <li key={s.start} className={selected.has(s.start) ? 'selected' : ''}>
            {own && (
              <input type="checkbox" checked={selected.has(s.start)} onChange={() => toggle(s.start)} aria-label={`Select Strike #${s.strike}`} />
            )}
            <StrikeCoin strike={s.strike} rank={s.rank} size="sm" />
            <div className="seg-main">
              <Traits traits={s.traits} rank={s.rank} />
              <span className="mono small muted">#{(BigInt(s.start) / BASE).toLocaleString()} – #{((BigInt(s.end) - 1n) / BASE).toLocaleString()}</span>
            </div>
            <span className="mono seg-amt">{fmtTokens(BigInt(s.end) - BigInt(s.start))}</span>
          </li>
        ))}
      </ul>
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

// "If I sell or send N tokens from this account, what melts?"
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
    <div className="preview">
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <input placeholder="Tokens to sell or send" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Amount" />
        <button className="btn btn-ghost">Preview</button>
      </form>
      {err && <ErrorNote error={err} />}
      {res && (
        <div className="small">
          <p>{fmtTokens(res.fromMelted)} ordinary tokens leave first.</p>
          {res.segments.length ? (
            <>
              <p className="melt-word">Then these rare tokens would melt:</p>
              <SegmentList segments={res.segments} />
              <p className="muted">To sell rare tokens without melting them, seal them and list the envelope on the desk.</p>
            </>
          ) : (
            <p className="ok-word">No rare tokens would melt.</p>
          )}
        </div>
      )}
    </div>
  );
}

function EnvelopeCard({ envelope: e, own }: { envelope: Envelope; own: boolean }) {
  const vault = useVault();
  const [mode, setMode] = useState<null | 'list' | 'gift' | 'withdraw'>(null);
  const [price, setPrice] = useState('');
  const [to, setTo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const close = () => {
    setMode(null);
    setErr(null);
  };

  return (
    <article className="card">
      <div className="card-head">
        <span className="pill pill-seal">Envelope {short(e.address)}</span>
        {e.status === 'listed' ? <span className="price">{sol(e.price)} <small>SOL</small></span> : <span className="pill">Sealed</span>}
      </div>
      <SegmentList segments={e.segments} empty="No rare tokens — this seal was invalid, so the contents are ordinary $PROOF." />
      {BigInt(e.common) > 0n && <p className="small muted">+ {fmtTokens(e.common)} ordinary $PROOF</p>}
      {own && (
        <div className="card-foot">
          {e.status === 'listed' ? (
            <button className="btn btn-ghost" onClick={() => runTx('Cancel listing', () => vault.cancel(e.holder, e.address))}>Cancel listing</button>
          ) : (
            <>
              <button className="btn btn-primary" onClick={() => setMode('list')}>List on desk</button>
              <button className="btn btn-ghost" onClick={() => setMode('gift')}>Gift</button>
              <button className="btn btn-ghost danger-text" onClick={() => setMode('withdraw')}>Withdraw…</button>
            </>
          )}
        </div>
      )}

      {mode === 'list' && (
        <Modal title="List on the collector desk" onClose={close}>
          <SegmentList segments={e.segments} />
          <label className="field">
            Price in SOL
            <input value={price} onChange={(x) => setPrice(x.target.value)} inputMode="decimal" placeholder="e.g. 1.5" autoFocus />
          </label>
          <p className="small muted">The envelope stays in the vault. A buyer pays you directly and becomes the holder in the same transaction.</p>
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
            Withdrawing sends the tokens back to your wallet as <strong>ordinary $PROOF</strong>. Their rarity is destroyed permanently —
            no one can ever restore it.
          </p>
          <SegmentList segments={e.segments} />
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
