import { Fragment, useEffect, useState } from 'react';
import { PixelLoader, PixelTick } from '../components/PixelTick.tsx';
import { FilterMenu } from '../components/FilterMenu.tsx';
import { ENV_H, ENV_W, envelopeShape } from '../components/HeroWord.tsx';
import { PixelIcon, TraitIcon, rollIconName, shareText, traitShare } from '../components/TraitIcons.tsx';
import { TIER_NAMES, tier } from '../format.ts';
import { api, useApi } from '../api.ts';
import type { Envelope, Stats } from '../api.ts';
import { useConfig, useVault } from '../App.tsx';
import type { Check } from '../chain.ts';
import { useWallet } from '../chain.ts';
import { feeOf, feePct, fmtRange, fmtTokens, short, sol } from '../format.ts';
import { matches, verifyReveal } from '../verify.ts';
import { Addr, ErrorNote, Loading, Modal, SegmentList, StrikeCardView, Traits, runTx } from '../components/ui.tsx';
import { RollBadge } from '../components/Roll.tsx';

type Order = 'low' | 'high';
const TRAIT_NAMES = ['Genesis', 'Key Date', 'Final Strike', 'Common Date', 'Double Die', 'Wrong Planchet', 'Off Center', 'Clipped Planchet', 'Die Crack'];
// The rolled tiers, rarest first, so a rolled envelope can be found by its tier.
const ROLL_NAMES = ['Hoard', 'Pattern', 'Die Trial', 'Overstrike', 'Restrike', 'Second Strike', 'Recoinage', 'Reissue', 'Mint Run', 'Assay', 'Coal'];
const ROLL_POINTS: Record<string, number> = { Hoard: 100, Pattern: 85, 'Die Trial': 70, Overstrike: 55, Restrike: 45, 'Second Strike': 30, Recoinage: 25, Reissue: 20, 'Mint Run': 15, Assay: 10, Coal: 0 };
function RollMark({ name }: { name: string }) {
  const icon = rollIconName(name);
  return icon ? <span className={`trait-icon t${tier(ROLL_POINTS[name] ?? 0)}`}><PixelIcon name={icon} unit={1.5} tight /></span> : null;
}

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
  // A listing's rarity is its rarest Strike or its rolled tier; its traits are its Strikes' traits plus any rolled tier.
  const rarityOf = (e: Envelope) => tier(Math.max(e.segments.reduce((m, s) => Math.max(m, s.rank), 0), e.roll?.points ?? 0));
  const traitsOf = (e: Envelope) => [...e.segments.flatMap((s) => s.traits ?? []), ...(e.roll ? [e.roll.name] : [])];
  const all = data ?? [];
  const count = (n: number) => (n ? `${n} listed` : '');
  const listings = [...all]
    .filter((e) =>
      (term === '' || e.segments.some((s) => String(s.strike) === term) || e.address.toLowerCase().includes(term) || e.holder.toLowerCase().includes(term) || (e.roll?.name.toLowerCase().includes(term) ?? false)) &&
      (!tiers.length || tiers.includes(rarityOf(e))) &&
      (!traits.length || traitsOf(e).some((t) => traits.includes(t))))
    .sort((a, b) => (order[0] ? (order[0] === 'high' ? -1 : 1) * Number(BigInt(a.price) - BigInt(b.price)) : 0));
  const clear = () => { setQ(''); setTiers([]); setTraits([]); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Collector desk</h1>
          {/* DRAFT shorter line, awaiting approval. The full version is in the pop-up checks. */}
          <p className="muted page-sub">Sealed envelopes for sale. The tokens never leave the vault, so their rarity stays intact.</p>
        </div>
        {/* The two headline numbers, in the same square as on Strikes and Rolls. DRAFT labels. */}
        {data && (
          <div className="roll-stat-box">
            <div><strong>{data.length.toLocaleString()}</strong><span className="muted">Listed now</span></div>
            <div><strong>{data.length ? `${sol(data.reduce((m, e) => (BigInt(e.price) < BigInt(m) ? e.price : m), data[0].price))}` : '0'}</strong><span className="muted">Floor, SOL</span></div>
          </div>
        )}
      </div>
      {/* Search, as on the Strikes page. DRAFT wording, awaiting approval. */}
      <section className="strike-search top-search">
        <form className="search-row" onSubmit={(e) => e.preventDefault()}>
          <input placeholder="Search all listings by Strike number, envelope or wallet" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search listings" />
          {/* Filters about what is for sale: counts are of current listings, and rolled envelopes count too. */}
          <FilterMenu label="Rarity" options={[0, 1, 2, 3].map((t) => ({ value: t, label: TIER_NAMES[t], mark: <i className={`tier-dot t${t}`} />, note: count(all.filter((e) => rarityOf(e) === t).length) }))} chosen={tiers} onToggle={(v) => toggle(tiers, setTiers, v)} />
          <FilterMenu label="Trait" options={[...TRAIT_NAMES, ...ROLL_NAMES].map((n) => ({ value: n, label: n, mark: ROLL_NAMES.includes(n) ? <RollMark name={n} /> : <TraitIcon trait={n} />, note: count(all.filter((e) => traitsOf(e).includes(n)).length), sep: n === 'Double Die' || n === ROLL_NAMES[0], heading: n === 'Genesis' ? 'Date' : n === 'Double Die' ? 'Error' : n === ROLL_NAMES[0] ? 'Rolled' : undefined }))} chosen={traits} onToggle={(v) => toggle(traits, setTraits, v)} />
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
      {/* The same facts as before, laid out as a labelled list like the card above. DRAFT wording. */}
      <dl className="post-details buy-terms">
        <dt>You pay</dt><dd><strong>{sol(envelope.price)} SOL</strong>, exactly the price</dd>
        <dt>Seller gets</dt><dd>{sol(BigInt(envelope.price) - feeOf(envelope.price, config.feeBps))} SOL</dd>
        <dt>Desk fee</dt><dd>{sol(feeOf(envelope.price, config.feeBps))} SOL ({feePct(config.feeBps)}) to Sequents</dd>
        <dt>Then</dt><dd>The envelope is yours. Keep it, gift it or list it again.</dd>
        <dt>Withdraw</dt><dd className="muted">Taking the tokens out melts them into ordinary $PROOF.</dd>
      </dl>

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
// Shared with the wallet page's envelope cards. A rolled envelope takes its rolled tier's colour.
export function EnvelopePic({ envelope }: { envelope: Envelope }) {
  const top = Math.max(envelope.segments.reduce((m, s) => Math.max(m, s.rank), -1), envelope.roll ? envelope.roll.points : -1);
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
      <EnvelopeDetails envelope={e} />
    </>
  );
}

// What is inside an envelope, as one labelled list. Shared by the desk cards and the wallet page's envelopes.
export function EnvelopeDetails({ envelope: e, showAddress = true }: { envelope: Envelope; showAddress?: boolean }) {
  // DRAFT labels, awaiting approval.
  return (
    <>
    <dl className="post-details">
      {showAddress && <><dt>Envelope</dt><dd>{short(e.address)}</dd></>}
      {(e.roll || e.rolling) && <><dt>Rolled</dt><dd><RollBadge e={e} /></dd></>}
      {!e.segments.length && <><dt>Inside</dt><dd className="muted">{e.roll ? 'Ordinary $PROOF carrying a rolled tier.' : 'No rare Strikes: the contents are ordinary $PROOF.'}</dd></>}
      {BigInt(e.common) > 0n && <><dt>Also</dt><dd>{fmtTokens(e.common)} ordinary $PROOF</dd></>}
    </dl>
    {/* Each Strike inside, as the same Strike card as on the Strikes page. */}
    {e.segments.length > 0 && (
      <div className="env-strikes">
        {e.segments.map((s) => {
          const amount = BigInt(s.end) - BigInt(s.start);
          return (
            <div key={s.start} className="strike-mini">
              <StrikeCardView strike={s.strike} rank={s.rank} traits={s.traits} part={amount} whole={1_000_000_000_000n} sub={`${fmtTokens(amount)} tokens`} />
            </div>
          );
        })}
      </div>
    )}
    </>
  );
}
