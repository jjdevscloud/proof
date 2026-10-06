import { useConfig } from '../App.tsx';
import { Addr } from '../components/ui.tsx';

export function Rules() {
  const config = useConfig();
  return (
    <article className="prose">
      <p className="eyebrow">How Sequents works</p>
      <h1>Same coin. Two markets.</h1>
      <p className="lede">
        A 1964 silver quarter spends as 25 cents at a shop, but a coin dealer pays far more for it — because collectors care
        <em> which</em> quarter it is. Sequents brings that to $PROOF. Jupiter is the shop. The collector desk is the dealer.
      </p>

      <h2>1. Every token has a number</h2>
      <p>
        Tokens are numbered in the order they're bought off the bonding curve. Each block of 1,000,000 is a <strong>Strike</strong>.
        Some Strikes are rare. Position-based tiers (Genesis, Key Date) go to the earliest Strikes; random errors (Double Die and
        others) are assigned after the sale from a public Solana block, so nobody can know them in advance. The rules are
        committed on-chain before the first buy, and anyone can verify any Strike from its page.
      </p>

      <h2>2. Rarity lives in two places only</h2>
      <ul>
        <li><strong>The account that bought it off the curve.</strong> Your original purchase keeps its numbers.</li>
        <li><strong>A sealed envelope.</strong> A vault account controlled by the Sequents program, holding exactly the tokens you sealed.</li>
      </ul>

      <h2>3. Anything that leaves, melts</h2>
      <p>
        Sell on Jupiter, send to a friend, sell back to the curve, change the account's owner, or withdraw from an envelope —
        the tokens that leave become ordinary $PROOF, permanently. Melted tokens are never rare again, so every melt makes the
        survivors scarcer.
      </p>
      <div className="callout">
        <strong>Selling some, keeping your rare ones:</strong> when tokens leave an origin account, ordinary tokens go first,
        then the least rare. Use “What melts if I sell?” on your wallet page before you trade.
      </div>

      <h2>4. Selling rarity without melting it</h2>
      <p>
        Seal rare tokens into an envelope and list it on the desk. A buyer pays you and becomes the envelope's holder in one
        transaction — the tokens never move, so nothing melts. The seller receives the price minus a {config.feeBps / 100}% Sequents
        desk fee. The buyer can keep it, gift it, relist it, or withdraw (which melts).
      </p>

      <h2>5. Why the premium can't go below the coin</h2>
      <p>
        A rare lot can always be withdrawn and sold as ordinary $PROOF at market price. The premium is the only part that depends
        on collectors — and ordinary $PROOF can itself go up or down.
      </p>

      <h2>What you can check yourself</h2>
      <ul>
        <li>The $PROOF mint: {config.pending ? <span className="muted">announced at launch</span> : <Addr value={config.mint} />}</li>
        <li>The Sequents vault program: {config.pending ? <span className="muted">deployed at launch</span> : <Addr value={config.vaultProgramId} />}</li>
        <li>The trait commitment, posted by <Addr value={config.revealAuthority} /> before the first buy</li>
        <li>Every desk listing runs on-chain safety checks in your browser before you can buy</li>
        <li>Two independent indexers publish matching ledger fingerprints (shown in the footer)</li>
      </ul>
      <p className="muted small">
        The blockchain sees every $PROOF token as identical. Rarity is defined by the published Sequents rules and computed by our
        open-source indexer — anyone can replay the chain and get the same result.
      </p>
    </article>
  );
}
