import { useState } from 'react';

// The glossary: every name and key term of the project in one place, A to Z, with a search box.
// Plain text only. DRAFT definitions, awaiting Harriet's approval.
const TERMS: [string, string][] = [
  ['After the curve', 'Bought once the bonding curve has sold out, on any exchange. These tokens are ordinary, but they can be sealed and rolled for a rolled tier.'],
  ['Assay', 'A rolled tier, Uncommon. Named for the test that checks a coin\'s metal.'],
  ['Bonding curve', 'The pump.fun sale that first sells $PROOF, at a price that rises with each purchase. Only tokens bought here get numbers.'],
  ['Clipped Planchet', 'An error trait, Rare. A blank punched from the edge of the metal strip, so it comes out with a piece missing.'],
  ['Coal', 'The roll result that wins nothing, Common. A Coal envelope can roll again.'],
  ['Collector desk', 'Where sealed envelopes are listed and bought. Also called the desk.'],
  ['Commitment', 'The fingerprint of the rules file, posted on chain before the first token was sold, so the rules cannot change afterwards.'],
  ['Common', 'The lowest rarity band, 0 points.'],
  ['Common Date', 'The date trait of every Strike that is not Genesis, Key Date or Final Strike. Named for a year struck in large numbers.'],
  ['Date trait', 'The trait a Strike gets from its position on the curve. Known from the moment it is sold.'],
  ['Desk fee', 'The 1.5% of each desk sale that goes to the Sequents treasury.'],
  ['Die Crack', 'An error trait, Uncommon. A crack in a worn die that leaves a raised line on every coin after.'],
  ['Die Trial', 'A rolled tier, Legendary. Named for a test strike made to check a new die.'],
  ['Double Die', 'The rarest error trait, Legendary. A die pressed twice out of line, so every coin shows doubled letters.'],
  ['Envelope', 'A vault run by the Sequents program that holds sealed tokens. The tokens never move again, so they can be sold without melting.'],
  ['Error', 'A random trait drawn after the sale from a Solana block nobody could predict. A Strike has at most one.'],
  ['Final Strike', 'The date trait of Strike #793, the short last Strike. Named for the last coin a die makes.'],
  ['Fingerprint', 'A hash of the whole ledger, published by the indexer so anyone running their own copy can compare.'],
  ['Genesis', 'The date trait of Strikes #0 to #4, the first five sold. Named for Bitcoin\'s first block.'],
  ['Gift', 'Giving an envelope to another wallet. Nothing melts.'],
  ['Hoard', 'The rarest rolled tier, Legendary. Named for a buried stash of coins found years later.'],
  ['Indexer', 'The open source software that reads the chain and applies the Sequents rules. Anyone can run it.'],
  ['Exchange', 'Any market where $PROOF trades after the curve. Every token is priced the same there.'],
  ['Key Date', 'The date trait of Strikes #5 to #24. Named for a scarce year a collector needs to complete a set.'],
  ['Legendary', 'The highest rarity band, 70 points and up.'],
  ['List', 'Putting an envelope up for sale on the desk at a price.'],
  ['Melt', 'What happens to rare tokens that leave their origin account or envelope. They become ordinary $PROOF for good.'],
  ['Mint Run', 'A rolled tier, Uncommon. Named for a batch of coins struck in one session.'],
  ['Off Center', 'An error trait, Rare. A blank seated badly in the press, so the design lands partly off the coin.'],
  ['On the curve', 'Bought from the bonding curve during the sale. These tokens get numbers, and their Strikes can carry date and error traits.'],
  ['Ordinary $PROOF', 'Tokens with no rarity: bought after the curve, or melted.'],
  ['Origin account', 'The account that bought tokens off the curve. One of the two places rarity can live.'],
  ['Overstrike', 'A rolled tier, Rare. Named for a coin struck on top of an old one.'],
  ['Pattern', 'A rolled tier, Legendary. Named for a trial coin struck to test a design.'],
  ['Points', 'The score of each trait or rolled tier. They add up to a Strike\'s rank and set its rarity.'],
  ['Position', 'A token\'s number, given in the order it was bought off the curve.'],
  ['$PROOF', 'The first token to use Sequent Theory.'],
  ['Rank', 'A Strike\'s date points plus its error points. Higher is rarer.'],
  ['Rare', 'The rarity band from 30 to 69 points.'],
  ['Rarity', 'The overall grade of one Strike or one rolled envelope: Common, Uncommon, Rare or Legendary. It comes from the points of its traits, not from your whole bag.'],
  ['Rarity band', 'One of four groups set by points: Common, Uncommon, Rare and Legendary.'],
  ['Recoinage', 'A rolled tier, Uncommon. Named for a mint calling in old coins and striking them again.'],
  ['Reissue', 'A rolled tier, Uncommon. Named for a coin put back into production.'],
  ['Restrike', 'A rolled tier, Rare. Named for a coin struck later from an original die.'],
  ['Reveal', 'The moment the errors are drawn and published, after the curve sells out.'],
  ['Roll', 'Paying 0.01 SOL for a chance that an envelope of at least 50,000 ordinary $PROOF wins a rolled tier.'],
  ['Rolled tier', 'One of ten tiers an envelope can win by rolling, from Assay to Hoard.'],
  ['Seal', 'Moving tokens into an envelope. The only time sealed tokens ever move.'],
  ['Second Strike', 'A rolled tier, Rare. Named for a coin that goes through the press twice.'],
  ['Seed block', 'The Solana block, produced after the sale, whose hash decides the errors or a roll.'],
  ['Sequent Theory', 'The idea behind Sequents: give each token of a fungible coin a number and a history, without changing the token.'],
  ['Sequents', 'The rules that number every token and decide which ones are rare.'],
  ['Strike', 'A block of one million numbered tokens. There are 794, from #0 to #793.'],
  ['Surviving', 'The share of a Strike that is still rare. It can only go down.'],
  ['Trait', 'A label a Strike can carry, like Genesis or Double Die.'],
  ['Uncommon', 'The rarity band from 1 to 29 points.'],
  ['Verify', 'Recomputing traits or checking a listing in your own browser, with no trust in this website.'],
  ['Withdraw', 'Taking tokens out of an envelope. It closes the envelope and melts them.'],
  ['Wrong Planchet', 'An error trait, Legendary. A coin struck on a blank meant for another coin.'],
];

export function Glossary() {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const found = TERMS.filter(([t, d]) => !query || t.toLowerCase().includes(query) || d.toLowerCase().includes(query))
    .sort((a, b) => a[0].replace(/^\$/, '').localeCompare(b[0].replace(/^\$/, '')));
  // Group by first letter, ignoring a leading $.
  const groups = new Map<string, [string, string][]>();
  for (const row of found) {
    const k = row[0].replace(/^\$/, '')[0].toUpperCase();
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Glossary</h1>
          {/* DRAFT line, awaiting Harriet's approval. */}
          <p className="muted page-sub">Every name and key term in Sequents, A to Z.</p>
        </div>
      </div>
      <section className="panel glossary">
        <input className="glossary-search" placeholder="Search the glossary" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the glossary" />
        {!found.length && <p className="muted">Nothing matches "{q}".</p>}
        {[...groups].map(([letter, rows]) => (
          <div key={letter} className="glossary-group">
            <span className="glossary-letter">{letter}</span>
            <dl>
              {rows.map(([t, d]) => (
                <div key={t} className="glossary-row">
                  <dt>{t}</dt>
                  <dd className="muted">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </section>
    </>
  );
}
