import { useConfig } from '../App.tsx';
import { Addr } from '../components/ui.tsx';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { StepNav } from '../components/StepNav.tsx';
import { CoinStream } from '../components/CoinStream.tsx';
import { PixelIcon, rollIconName } from '../components/TraitIcons.tsx';
import { tier } from '../format.ts';
import type { Config } from '../api.ts';
import { fmtTokens, sol } from '../format.ts';
import type { ReactNode } from 'react';
import { Modal } from '../components/ui.tsx';
import { EnvelopeFlow, FloorWave, MeltCurve, StrikeRuler, TwoPlaces } from '../components/graphics.tsx';

export function Rules() {
  const config = useConfig();
  // The rule boxes come in one by one, left to right, as each row scrolls into view.
  const worksRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const boxes = [...worksRef.current!.children] as HTMLElement[];
    const cols = Math.max(1, Math.round(worksRef.current!.clientWidth / (boxes[0]?.offsetWidth || 1)));
    boxes.forEach((b, i) => (b.style.transitionDelay = `${(i % cols) * 220}ms`));
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')), { threshold: 0.2 });
    boxes.forEach((b) => io.observe(b));
    return () => io.disconnect();
  }, []);
  const [open, setOpen] = useState<number | null>(null);
  // The check table's rows come in one by one once it scrolls into view.
  const checkRef = useRef<HTMLElement>(null);
  const [checkIn, setCheckIn] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setCheckIn(true), { threshold: 0.3 });
    io.observe(checkRef.current!);
    return () => io.disconnect();
  }, []);
  return (
    <WorkNav.Provider value={{ open, setOpen, total: config.roll ? 6 : 5 }}>
    <article className="prose">
      {/* DRAFT title, awaiting approval. */}
      <div className="caption rules-caption"><h1>How Sequent Theory numbers<br />every token.</h1></div>
      {/* The story, large, in the frame where the overview has its word. */}
      <div className="frame hero-frame rules-hero">
        <CoinStream />
        <p className="lines-text rules-story">A 1955 doubled die penny spends as one cent at a shop but sells to a dealer for thousands, because only a few ever left the mint. Sequents does the same for $PROOF. On Solana every token is equal. On the desk, a collector decides what a rare one is worth.</p>
      </div>
      {/* The coin words, three short lines under the frame like the overview's trio. */}
      <div className="trio">
        <p><strong>Strike</strong> <span>a coin pressed from a die. Here, a block of one million tokens.</span></p>
        <p><strong>Error</strong> <span>a flaw from a real mint, like a doubled die. Here, a random trait.</span></p>
        <p><strong>Melt</strong> <span>a coin taken out of circulation stops being a coin.</span></p>
      </div>
      <svg className="scroll-cue" viewBox="0 0 16 28" aria-hidden><path d="M8 1v25M1 19l7 7 7-7" /></svg>

      <div className="works" ref={worksRef}>

      <Work index={0} title="1. Every token has a number" graphic={<StrikeRuler />}>
      <p>
        Tokens are numbered in the order they're bought off the bonding curve. Each block of 1,000,000 is a <strong>Strike</strong>.
        Some Strikes are rare. Position-based tiers (Genesis, Key Date) go to the earliest Strikes; random errors (Double Die and
        others) are assigned after the sale from a public Solana block, so nobody can know them in advance. The rules are
        committed on-chain before the first buy, and anyone can verify any Strike from its page.
      </p>
      </Work>

      <Work index={1} title="2. Rarity lives in two places only" graphic={<TwoPlaces />}>
      <ul>
        <li><strong>The account that bought it off the curve.</strong> Your original purchase keeps its numbers.</li>
        <li><strong>A sealed envelope.</strong> A vault account controlled by the Sequents program, holding exactly the tokens you sealed.</li>
      </ul>
      </Work>

      <Work index={2} title="3. Anything that leaves, melts" graphic={<MeltCurve />}>
      <p>
        Sell on Jupiter, send to a friend, sell back to the curve, change the account's owner, or withdraw from an envelope, and
        the tokens that leave become ordinary $PROOF, permanently. Melted tokens are never rare again, so every melt makes the
        survivors scarcer.
      </p>
      <div className="callout">
        <strong>Selling some, keeping your rare ones:</strong> when tokens leave an origin account, ordinary tokens go first,
        then the least rare. Use “What melts if I sell?” on your wallet page before you trade.
      </div>
      </Work>

      <Work index={3} title="4. Selling rarity without melting it" graphic={<EnvelopeFlow />}>
      <p>
        Seal rare tokens into an envelope and list it on the desk. A buyer pays you and becomes the envelope's holder in one
        transaction. The tokens never move, so nothing melts. The seller receives the price minus a {config.feeBps / 100}% Sequents
        desk fee. The buyer can keep it, gift it, relist it, or withdraw (which melts).
      </p>
      </Work>

      <Work index={4} title="5. Why the premium can't go below the coin" graphic={<FloorWave />}>
      <p>
        A rare lot can always be withdrawn and sold as ordinary $PROOF at market price. The premium is the only part that depends
        on collectors, and ordinary $PROOF can itself go up or down.
      </p>
      </Work>

      {config.roll && (
        <Work index={5} title="6. Roll an envelope" graphic={<TwoRarities roll={config.roll} />} full={
          <>
        <p>
          Ordinary $PROOF can roll for a rare tier. Seal at least {fmtTokens(config.roll.minEntry)} into an envelope from your
          wallet page and click Roll ({sol(config.roll.feeLamports)} SOL to the Sequents treasury per roll). The result comes from
          the first Solana block at least {config.roll.seedDelaySlots} slots after your roll lands, which nobody can know when you
          click: sha256 of the roll's signature and that block's hash picks the tier, with fixed odds and no limit on how many of
          each can exist. Your browser computes the result itself in a second or two; the ledger records it once the block is final.
        </p>
        <p>
          A rolled tier lives on the envelope: list it on the desk, gift it, or keep it. {config.roll.fallback.name} envelopes can roll
          again. Withdrawing the tokens melts the tier, like any rarity.
        </p>
          </>
        }>
        {/* DRAFT short version for the box, awaiting approval. The full text is in the pop-up. */}
        <p>
          Ordinary $PROOF can roll for a rare tier. Seal at least {fmtTokens(config.roll.minEntry)} into an envelope and roll for
          {' '}{sol(config.roll.feeLamports)} SOL. The next Solana block decides, with fixed odds and no cap.
        </p>
        </Work>
      )}
      </div>

      {/* What you can check yourself, one thing per row. */}
      <section className="checkable traits-free" ref={checkRef}>
        <h2>What you can check yourself</h2>
        <p>
          The blockchain sees every $PROOF token as identical. Rarity is defined by the published Sequents rules and computed by our
          open-source indexer. Anyone can replay the chain and get the same result.
        </p>
        <table className="table">
          <tbody>
            <tr className={checkIn ? 'step in' : 'step'} style={{ transitionDelay: `${0 * 180}ms` }}><td>The $PROOF mint</td><td className="num">{config.pending ? <span className="muted">announced at launch</span> : <Addr value={config.mint} />}</td></tr>
            <tr className={checkIn ? 'step in' : 'step'} style={{ transitionDelay: `${1 * 180}ms` }}><td>The Sequents vault program</td><td className="num">{config.pending ? <span className="muted">deployed at launch</span> : <Addr value={config.vaultProgramId} />}</td></tr>
            <tr className={checkIn ? 'step in' : 'step'} style={{ transitionDelay: `${2 * 180}ms` }}><td>The trait commitment, posted before the first buy</td><td className="num"><Addr value={config.revealAuthority} /></td></tr>
            <tr className={checkIn ? 'step in' : 'step'} style={{ transitionDelay: `${3 * 180}ms` }}><td>Every desk listing runs on-chain safety checks</td><td className="num muted">in your browser, before you can buy</td></tr>
            <tr className={checkIn ? 'step in' : 'step'} style={{ transitionDelay: `${4 * 180}ms` }}><td>Two independent indexers publish matching ledger fingerprints</td><td className="num muted">shown in the footer</td></tr>
          </tbody>
        </table>
        <a className="btn btn-primary rules-back" href="#/">Back to overview</a>
      </section>
    </article>
    </WorkNav.Provider>
  );
}

// Which rule is open in the pop-up, shared by the five boxes so the pop-up can step between them.
const WorkNav = createContext<{ open: number | null; setOpen: (i: number | null) => void; total: number }>({ open: null, setOpen: () => {}, total: 0 });

// One section: its title, its line graphic and the text, all visible. The corner icon opens it large,
// and the pop-up steps on to the other rules without closing.
function Work({ index, title, graphic, children, full }: { index: number; title: string; graphic: ReactNode; children: ReactNode; full?: ReactNode }) {
  const { open, setOpen, total } = useContext(WorkNav);
  return (
    <section className="work">
      <button type="button" className="work-expand" onClick={() => setOpen(index)} aria-label={`Open ${title}`}>
        <svg viewBox="0 0 14 14" aria-hidden><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" /></svg>
      </button>
      <h2>{title}</h2>
      {graphic}
      {children}
      {open === index && (
        <Modal title={title} onClose={() => setOpen(null)}>
          <div className="mech-modal work-modal">
            {graphic}
            {full ?? children}
          </div>
          <StepNav at={index} total={total} onMove={setOpen} label="Rules" />
        </Modal>
      )}
    </section>
  );
}

// Box 6's picture: the two ways a token can be rare. On the left the traits a Strike gets from the
// bonding curve, on the right the tiers an envelope can roll after it. Each with its symbol.
const CURVE_TRAITS: [string, string, number][] = [
  ['Genesis', 'genesis', 40], ['Key Date', 'keydate', 15], ['Final Strike', 'final', 10], ['Common Date', 'common', 0],
  ['Double Die', 'doubledie', 100], ['Wrong Planchet', 'wrongplanchet', 70], ['Off Center', 'offcenter', 50],
  ['Clipped Planchet', 'clipped', 30], ['Die Crack', 'diecrack', 15],
];
function TwoRarities({ roll }: { roll: NonNullable<Config['roll']> }) {
  const rolled = [...roll.tiers.map((t) => [t.name, t.points] as const), [roll.fallback.name, roll.fallback.points] as const];
  return (
    <div className="gfx two-rare">
      {/* DRAFT labels, awaiting approval. */}
      <div>
        <span className="two-rare-head">On the curve</span>
        <ul>{CURVE_TRAITS.map(([n, icon, p]) => <li key={n} className={`t${tier(p)}`} title={n}><PixelIcon name={icon} unit={2} /></li>)}</ul>
      </div>
      <div>
        <span className="two-rare-head">After the curve</span>
        <ul>{rolled.map(([n, p]) => <li key={n} className={`t${tier(p)}`} title={n}>{rollIconName(n) && <PixelIcon name={rollIconName(n)!} unit={2} />}</li>)}</ul>
      </div>
    </div>
  );
}
