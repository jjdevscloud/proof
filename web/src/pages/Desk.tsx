import { Fragment, useEffect, useState } from 'react';
import { PixelLoader, PixelTick } from '../components/PixelTick.tsx';
import { FilterMenu } from '../components/FilterMenu.tsx';
import { ENV_H, ENV_W, envelopeShape } from '../components/HeroWord.tsx';
import { TraitIcon, shareText, traitShare } from '../components/TraitIcons.tsx';
import { TIER_NAMES, tier } from '../format.ts';
import { api, useApi } from '../api.ts';
import type { Envelope, Stats } from '../api.ts';
import { useConfig, useVault } from '../App.tsx';
import type { Check } from '../chain.ts';
import { useWallet } from '../chain.ts';
import { feeOf, feePct, fmtRange, fmtTokens, short, sol } from '../format.ts';
import { matches, verifyReveal } from '../verify.ts';
import { Addr, ErrorNote, Loading, Modal, SegmentList, Traits, runTx } from '../components/ui.tsx';
import { RollBadge } from '../components/Roll.tsx';

type Order = 'low' | 'high';
const TRAIT_NAMES = ['Genesis', 'Key Date', 'Final Strike', 'Common Date', 'Double Die', 'Wrong Planchet', 'Off Center', 'Clipped Planchet', 'Die Crack'];

export function Desk() {
  const { data, error } = useApi<Envelope[]>('/envelopes?status=listed');
  const [reviewing, setReviewing] = useState<Envelope | null>(null);
  // Search the listings: by Strike number, envelope or seller address, with rarity and trait filters
  // and a price order. Display only: the same listings, narrowed and sorted in the browser.
  const stats = useApi<Stats>('/stats');
  // Each rarity's share of all Strikes, from the live counts by rank.
  const byRank = stats.data?.byRank ?? [];
  const tierShare = (t: number) => shareText(byRank.filter((r) => tier(r.rank) === t).reduce((a, r) => a + r.strikes, 0), byRank.reduce((a, r) => a + r.strikes, 0));
  const [q, setQ] = useState('');
  const [tiers, setTiers] = useState<number[]>([]);
  const [traits, setTraits] = useState<string[]>([]);
  const [order, setOrder] = useState<Order[]>([]);
  const toggle = <T,>(list: T[], set: (v: T[]) => void, v: T) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const term = q.trim().replace(/^#/, '').toLowerCase();
  const searching = term !== '' || tiers.length > 0 || traits.length > 0;
  const listings = [...(data ?? [])]
    .filter((e) =>
      (term === '' || e.segments.some((s) => String(s.strike) === term) || e.address.toLowerCase().includes(term) || e.holder.toLowerCase().includes(term)) &&
      (!tiers.length || e.segments.some((s) => tiers.includes(tier(s.rank)))) &&
      (!traits.length || e.segments.some((s) => (s.traits ?? []).some((t) => traits.includes(t)))))
    .sort((a, b) => (order[0] ? (order[0] === 'high' ? -1 : 1) * Number(BigInt(a.price) - BigInt(b.price)) : 0));
  const clear = () => { setQ(''); setTiers([]); setTraits([]); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Collector desk</h1>
          <p className="muted page-sub">
            Sealed envelopes for sale. You buy the envelope: the tokens never leave the vault, so their rarity stays intact.
            Every listing is checked against the chain in your browser before you can buy.
          </p>
        </div>
      </div>
      {/* Search, as on the Strikes page. DRAFT wording, awaiting Harriet's approval. */}
      <section className="strike-search">
        <form className="search-row" onSubmit={(e) => e.preventDefault()}>
          <input placeholder="Search by Strike number, envelope or seller" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search listings" />
          <FilterMenu label="Rarity" options={[0, 1, 2, 3].map((t) => ({ value: t, label: TIER_NAMES[t], mark: <i className={`tier-dot t${t}`} />, note: tierShare(t) }))} chosen={tiers} onToggle={(v) => toggle(tiers, setTiers, v)} />
          <FilterMenu label="Trait" options={TRAIT_NAMES.map((n) => ({ value: n, label: n, mark: <TraitIcon trait={n} />, note: traitShare(n), sep: n === 'Double Die', heading: n === 'Genesis' ? 'Date, set by when it was bought' : n === 'Double Die' ? 'Error, assigned at the reveal' : undefined }))} chosen={traits} onToggle={(v) => toggle(traits, setTraits, v)} />
          <FilterMenu label="Price" options={[{ value: 'low' as Order, label: 'Lowest first' }, { value: 'high' as Order, label: 'Highest first' }]} chosen={order} onToggle={(v) => setOrder(order[0] === v ? [] : [v])} />
          <button className="btn btn-primary">Search</button>
        </form>
        {searching && (
          <p className="search-summary">
            <span className="muted">{listings.length} {listings.length === 1 ? 'envelope' : 'envelopes'} match</span>
            <button type="button" className="chip-clear" onClick={clear}>Clear all</button>
          </p>
        )}
      </section>
      {error && <ErrorNote error={error} />}
      {!data && !error && <Loading />}
      {data && !listings.length && searching && <p className="muted">No envelopes match.</p>}
      {data && !data.length && (
        <div className="panel empty">
          <h2>No envelopes listed right now</h2>
          <p className="muted">Holders seal rare tokens into envelopes from <a href="#/wallet">their wallet page</a> and list them here.</p>
        </div>
      )}
      <div className="cards">
        {listings.map((e) => (
          <article key={e.address} className="card listing post">
            {/* Like a post: who is selling at the top, then what, then the one action. */}
            <EnvelopeCard envelope={e} />
            <button className="btn btn-primary wide post-action" onClick={() => setReviewing(e)}>Review & buy</button>
          </article>
        ))}
      </div>
      {reviewing && <BuyModal envelope={reviewing} onClose={() => setReviewing(null)} />}
    </>
  );
}

function BuyModal({ envelope, onClose }: { envelope: Envelope; onClose: () => void }) {
  const vault = useVault();
  const config = useConfig();
  const wallet = useWallet();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const runChecks = async () => {
    setRunning(true);
    setErr(null);
    try {
      const list = await vault.checkEnvelope(envelope.address, { holder: envelope.holder, price: envelope.price, ranges: envelope.ranges });
      if (envelope.roll) list.push(await vault.verifyRoll(envelope.roll.signature, envelope.roll.name));
      if (envelope.rolling) list.push({ label: 'No roll in progress', ok: false, detail: 'wait a few seconds for the roll to settle' });
      const v = await verifyReveal(config);
      if (v.traits) {
        list.push({ label: 'Reveal verified against the commitment and the seed block', ok: v.ok, detail: '' });
        for (const seg of envelope.segments) {
          list.push({ label: `Strike #${seg.strike} is ${seg.traits?.join(' · ')}`, ok: matches(v, seg.strike, seg.traits), detail: 'recomputed in your browser' });
        }
      }
      setChecks(list);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const allOk = !!checks && checks.every((c) => c.ok);
  // Show the results one at a time, a moment apart, rather than all at once. Display only: the
  // checks themselves ran above, and the outcome is shown in full once the last one appears.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!checks) return;
    setShown(0);
    const id = setInterval(() => setShown((s) => (s >= checks.length ? s : s + 1)), 900);
    return () => clearInterval(id);
  }, [checks]);
  const revealed = !!checks && shown >= checks.length;
  const isSeller = wallet.address === envelope.holder;

  return (
    <Modal title={`Envelope ${short(envelope.address)}`} onClose={onClose}>
      {/* The same card as on the desk, larger. */}
      <div className="post buy-post"><EnvelopeCard envelope={envelope} /></div>
      <p className="small muted">
        You pay exactly the price. The seller receives {sol(BigInt(envelope.price) - feeOf(envelope.price, config.feeBps))} SOL;{' '}
        {sol(feeOf(envelope.price, config.feeBps))} SOL ({feePct(config.feeBps)}) is the Sequents desk fee.
      </p>
      <p className="small muted">
        Buying makes you the envelope's holder. You can keep it, gift it, list it again, or withdraw the tokens —
        withdrawing melts them into ordinary $PROOF.
      </p>

      {!checks && !running ? (
        <button className="btn btn-ghost wide" onClick={runChecks}>Verify holdings</button>
      ) : (
        <ul className="checks">
          {(checks ?? []).slice(0, shown).map((c) => (
            <li key={c.label} className={c.ok ? 'ok' : 'bad'}>
              <PixelTick bad={!c.ok} />
              <span>{c.label}{!c.ok && c.detail && <span className="muted small">, {c.detail}</span>}</span>
            </li>
          ))}
          {!revealed && <li className="checks-pending"><PixelLoader /><span className="muted">Checking the chain…</span></li>}
        </ul>
      )}
      {err && <ErrorNote error={err} />}
      {revealed && !allOk && <ErrorNote error="Some checks failed. Do not buy this envelope." />}

      {allOk && revealed && (
        !wallet.address ? (
          <button className="btn btn-primary wide" onClick={() => wallet.connect().catch((e) => setErr(e.message))}>Connect wallet to buy</button>
        ) : isSeller ? (
          <p className="muted">This is your own listing.</p>
        ) : (
          <button
            className="btn btn-primary wide"
            onClick={async () => {
              const sig = await runTx('Buy envelope', () => vault.buy(wallet.address!, envelope.holder, envelope.address, BigInt(envelope.price)));
              if (sig) onClose();
            }}
          >
            Buy for {sol(envelope.price)} SOL
          </button>
        )
      )}
    </Modal>
  );
}

// The envelope itself as the post's picture, in the colour of the rarest Strike sealed inside.
const ENVELOPE = envelopeShape(ENV_W, ENV_H, 0).map(([dc, dr]) => [dc + (ENV_W - 1) / 2, dr + (ENV_H - 1) / 2]);
function EnvelopePic({ envelope }: { envelope: Envelope }) {
  const top = envelope.segments.reduce((m, s) => Math.max(m, s.rank), -1);
  return (
    <svg className={`avatar ${top < 0 ? 'avatar-empty' : `t${tier(top)}`}`} viewBox={`-1 -1 ${ENV_W + 2} ${ENV_W + 2}`} aria-hidden shapeRendering="crispEdges">
      {ENVELOPE.map(([x, y]) => <rect key={`${x},${y}`} x={x + 0.08} y={y + 1 + 0.08} width={0.84} height={0.84} />)}
    </svg>
  );
}

// The top of a desk card and its details: the envelope, who sells it and the price, then what is inside.
// Shared by the desk and the buy pop-up, which shows it larger.
function EnvelopeCard({ envelope: e }: { envelope: Envelope }) {
  return (
    <>
      <header className="post-head">
        <EnvelopePic envelope={e} />
        <span className="post-who">
          <Addr value={e.holder} href={`#/wallet/${e.holder}`} />
          <span className="small muted">Seller</span>
        </span>
        <span className="price">{sol(e.price)} <small>SOL</small></span>
      </header>
      {/* What is inside, as one labelled list. DRAFT labels, awaiting Harriet's approval. */}
      <dl className="post-details">
        <dt>Envelope</dt><dd>{short(e.address)}</dd>
        {(e.roll || e.rolling) && <><dt>Rolled</dt><dd><RollBadge e={e} /></dd></>}
        {!e.segments.length && <><dt>Inside</dt><dd className="muted">{e.roll ? 'Ordinary $PROOF carrying a rolled tier.' : 'No rare Strikes: the contents are ordinary $PROOF.'}</dd></>}
        {e.segments.map((s) => {
          const amount = BigInt(s.end) - BigInt(s.start);
          const whole = amount === 1_000_000_000_000n;
          return (
            <Fragment key={s.start}>
              <dt className="post-split">Strike</dt><dd className="post-split"><a href={`#/strike/${s.strike}`}>#{s.strike}</a></dd>
              <dt>Traits</dt><dd><Traits traits={s.traits} rank={s.rank} /></dd>
              <dt>Tokens</dt>
              <dd>{whole ? `${fmtTokens(amount)}, the whole Strike` : <>{fmtTokens(amount)}<span className="muted"> (numbers {fmtRange(s.start, s.end).replace(' – ', ' to ')})</span></>}</dd>
            </Fragment>
          );
        })}
        {BigInt(e.common) > 0n && <><dt>Also</dt><dd>{fmtTokens(e.common)} ordinary $PROOF</dd></>}
      </dl>
    </>
  );
}
