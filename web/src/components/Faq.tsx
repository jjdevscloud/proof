import { useEffect, useRef, useState } from 'react';

// Frequently asked questions: one centred column, each question with a plus that opens its answer.
// DRAFT copy, awaiting Harriet's approval. Facts follow the rules, the whitepaper and the site guide.
const FAQ: [string, string][] = [
  ['Why seal my tokens instead of just holding them?', 'Holding keeps them rare, but the moment you sell or send them they melt. Sealing them in an envelope lets you sell them on the desk as a whole, and they stay rare.'],
  ['Can an envelope sell for more than the tokens inside it?', 'Yes, it can. Think of the market price as the floor, like the floor price of an NFT collection: every token costs the same on any exchange. On the desk the seller sets the price, and collectors pay what they think a rare Strike is worth, the way a rare NFT sells above floor. The floor still holds, because an envelope can always be withdrawn and sold as ordinary $PROOF.'],
  ['What is an envelope?', 'A vault run by the Sequents program. Seal tokens inside it and they never move again, so they can change hands without melting.'],
  ['Do I have to sell the rest of my bag before I seal?', 'No. You choose which Strikes go in, up to eight ranges per envelope, and only those move. Everything else stays in your account, and anything rare there stays rare.'],
  ['Can I sell some and keep my rare ones?', 'Yes. Ordinary tokens leave first, then the least rare. Check "What melts if I sell?" on your wallet page before you trade.'],
  ['What if I buy more $PROOF after the curve into the same wallet?', 'The new tokens are ordinary. They sit beside your rare ones and leave first when you sell, so they act as a buffer for your rare tokens.'],
  ['How do I move rare tokens to another wallet?', 'Seal them, then gift the envelope. Sending the tokens directly melts them.'],
  ['When will I know if my Strike has an error rarity?', 'At the reveal, about a minute after the curve sells out. The errors come from the first Solana block after that, and every Strike page shows the result.'],
  ['I bought late on the curve. Can I still get something rare?', 'Yes. Errors are drawn at random, so a late Strike has the same chance as an early one. And any ordinary $PROOF can be sealed and rolled.'],
  ['Can I roll an envelope that already holds rare tokens?', 'No. Only envelopes of at least 50,000 ordinary $PROOF can roll. Your rare Strikes keep the traits they already have.'],
];

// Where Still have a question? points: the Sequents account on X.
const X_URL = 'https://x.com/sequent_theory';

export function Faq() {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(i)) n.delete(i); else n.add(i);
    return n;
  });
  // The questions come in one by one, a moment apart, once the list scrolls into view (like the tables).
  const ref = useRef<HTMLUListElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setInView(true), { threshold: 0.15 });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);
  return (
    <section className="faq">
      {/* DRAFT heading, awaiting Harriet's approval. */}
      <h2>Questions</h2>
      <ul ref={ref}>
        {FAQ.map(([q, a], i) => (
          <li key={q} className={`step${inView ? ' in' : ''}${open.has(i) ? ' open' : ''}`} style={{ transitionDelay: `${i * 180}ms` }}>
            <button type="button" onClick={() => toggle(i)} aria-expanded={open.has(i)}>
              <span>{q}</span>
              <svg className="faq-plus" viewBox="0 0 14 14" aria-hidden><path d="M7 1v12M1 7h12" /></svg>
            </button>
            {open.has(i) && <p>{a}</p>}
          </li>
        ))}
      </ul>
      {/* DRAFT line and button, awaiting Harriet's approval. */}
      <div className="faq-more">
        <p className="muted">Still have a question?</p>
        <a className="btn btn-primary" href={X_URL} target="_blank" rel="noreferrer">Ask us on X</a>
      </div>
    </section>
  );
}
