# How Sequents Works

**Sequents is a rarity system for $PROOF.** On Jupiter, every $PROOF token is the same. Sequents numbers every token in buying order and makes some numbers rare, like collectible coins. You spend them like cash or sell them to collectors.

Website: https://sequents-production.up.railway.app

---

## 1. Every token has a number

- The pump.fun bonding curve sells **793,100,000 tokens**. They're numbered in the exact order they're bought off the curve.
- Every block of **1,000,000** numbers is a **Strike**, giving **794 Strikes** (#0 to #793). Strike #793 is a short one of 100,000.
- A number is issued only once. Tokens sold back to the curve and bought again are ordinary.

## 2. What makes a Strike rare

Each Strike gets traits, and its **rank** is the sum of its trait points.

**Date tiers.** These depend on position, so they're known from the start:

| Trait | Strikes | Points |
|---|---|---|
| Genesis | #0 – #4 | 40 |
| Key Date | #5 – #24 | 15 |
| Final Strike | #793 | 10 |
| Common Date | all others | 0 |

**Errors.** These are random, assigned after the sale, with at most one per Strike:

| Error | Count | Points |
|---|---|---|
| Double Die | 3 | 100 |
| Wrong Planchet | 6 | 70 |
| Off-Center | 12 | 50 |
| Clipped Planchet | 24 | 30 |
| Die Crack | 48 | 15 |

**Rarity bands:** 0 points is Common, 1–29 Uncommon, 30–69 Rare, 70+ Legendary.

### Why nobody can cheat, not even the team

1. **Before the token exists**, the fingerprint of the rules file is posted on-chain (the commit).
2. **After the curve sells out**, or when a 7-day deadline passes, the errors are drawn from the hash of a **future Solana block**. Nobody can predict it.
3. **The reveal is posted.** Anyone can recompute every Strike in their own browser with **"Verify in my browser"** on any Strike page. No trust in the website is needed.

## 3. Where rarity lives, and how it melts

Rarity survives in only **two places**:

1. **The account that bought it off the curve.**
2. **A sealed envelope.**

Anything that leaves those places **melts** into ordinary $PROOF, permanently:
- selling on Jupiter
- sending to someone
- selling back to the curve
- changing the account's owner
- withdrawing from an envelope

Melted tokens are never rare again, so every melt makes the survivors scarcer.

> **Selling some, keeping your rare ones:** when tokens leave an account, ordinary tokens go first, then the least rare. Use **"What melts if I sell?"** on your wallet page before you trade.

## 4. Envelopes and the collector desk

- **Seal:** move rare tokens into an envelope, a vault controlled by the Sequents program. Their rarity stays intact.
- **List** the envelope on the **collector desk**. A buyer pays and becomes the holder in one transaction. The tokens never move, so nothing melts.
- **Gift** an envelope to anyone, or **withdraw** the tokens (that melts them).
- **Desk fee:** 1.5% of each sale goes to the Sequents treasury.

**Buyer safety checks.** Before you can buy, your browser checks the listing against the chain:
- it's a genuine Sequents envelope holding the official $PROOF token
- nobody else can move the tokens
- the price matches
- the traits match the public reveal

**Price floor.** A rare lot can always be withdrawn and sold as ordinary $PROOF, so the collector premium sits on top of the coin's market value.

## 5. Roll your envelope

Ordinary $PROOF gets a chance at rarity too:

1. **Seal at least 50,000 ordinary $PROOF** into an envelope from your wallet page.
2. **Click Roll.** Each roll costs **0.01 SOL**.
3. **The next Solana blocks decide the result.** Nobody can know it when you click. Your browser shows the result within seconds.

| Tier | Rarity | Points | Chance per roll |
|---|---|---|---|
| Hoard | Legendary | 100 | 0.05% |
| Pattern | Legendary | 85 | 0.1% |
| Die Trial | Legendary | 70 | 0.2% |
| Overstrike | Rare | 55 | 0.4% |
| Restrike | Rare | 45 | 0.6% |
| Second Strike | Rare | 30 | 1% |
| Recoinage | Uncommon | 25 | 1.5% |
| Reissue | Uncommon | 20 | 2% |
| Mint Run | Uncommon | 15 | 3% |
| Assay | Uncommon | 10 | 4% |
| Coal | Common | 0 | 87.15% |

- **The odds never change**, and there's no cap on any tier.
- **Rolled Coal?** Roll the same envelope again.
- **Rolled a rare tier?** It stays on the envelope: list it on the desk, gift it, or keep it.
- **You keep your tokens.** Withdrawing them returns ordinary $PROOF and melts the rolled tier.
- **Live stats:** the **Strikes** page shows every tier, how many have been rolled, how many still exist, current listings and the latest rolls.

## 6. What's on the website

| Page | What it shows |
|---|---|
| **Overview** | The idea in one scroll, and a way to check any wallet |
| **Strikes** | All 794 Strikes as a bonding curve, a mint sheet or a gradient, the rarest Strikes, the rolled tiers and survival by rarity |
| **Strike #N** | Traits, how much survives and where, its full history, and in-browser verification |
| **Desk** | Envelopes for sale, with on-chain safety checks before buying |
| **My wallet** | Your rare tokens, envelopes, sealing, listing, gifting, withdrawing and rolling |
| **Rules** | How it all works, the roll odds, and what you can verify yourself |

## 7. What you can check yourself

- **The trait commitment** is posted on-chain before the first buy.
- **Every Strike's traits** can be recomputed in your browser from the committed rules and the public seed block.
- **Every desk listing** runs on-chain safety checks in your browser before you can buy.
- **Every roll result** can be recomputed from the chain.
- **Two independent indexers** publish matching ledger fingerprints.

*The blockchain sees every $PROOF token as identical. Rarity is defined by the published Sequents rules and computed by an open-source indexer, so anyone can replay the chain and get the same result.*
