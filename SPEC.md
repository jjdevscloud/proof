# Sequents — $PROOF Rarity Specification v1

Status: draft for launch. This file is the single source of truth. Anything not written
here is not a rule. Rules are frozen once the commit memo (§4) is posted.

Design in one line: **rarity lives only in the account that bought it off the curve, or in a
sealed envelope. Anything that leaves either place melts, permanently.**

---

## 1. Principles

1. **Deterministic.** Given the same finalized transactions in the same order, every
   implementation of these rules produces the same ledger, byte for byte (§9 fingerprint).
2. **Rarity only goes down.** Positions are issued once. Melted tokens never become rare
   again. Nothing can create rarity after the commit.
3. **The program guarantees custody; the indexer guarantees identity.** The vault program
   enforces who controls an envelope and that tokens only leave it one way. Which positions
   are inside is defined by these rules and computed by the indexer.

## 2. Constants

| Name | Value | Note |
|---|---|---|
| Decimals | 6 | pump.fun default — verify on the live mint |
| Base unit | 1 / 10^6 token | All positions and amounts are in base units |
| Saleable curve supply `S` | 793,100,000 tokens | pump.fun default — verify at launch |
| Strike size | 1,000,000 tokens | |
| Strike count | ceil(S / strike size) = 794 | Strike #793 is a short strike of 100,000 tokens |
| Total supply | 1,000,000,000 tokens | The non-saleable remainder is always common (§3.4) |

## 3. Numbering and issuance

### 3.1 Positions
Every saleable base unit has a **position** `p` in `[0, S)`. Strike of a position:
`floor(p / strike size)`. Displayed token numbers are whole tokens (`#7,000,000` = base
positions `[7,000,000,000,000, 7,000,001,000,000)`).

### 3.2 Curve buys
A **curve buy** is a token transfer out of the bonding-curve token account whose *direct
parent instruction* is a pump.fun instruction **other than** a listed non-buy instruction
(`migrate`, `withdraw`). pump.fun adds buy variants over time (`buy`, `buy_exact_sol_in`,
`buy_v2`, `buy_exact_quote_in_v2` as of 2026-10), so buys are defined by exclusion. Misclassifying
a migration is harmless: migration happens only once every saleable position is issued, so
`fresh` below is 0. For a curve buy of `a` base units:

1. First, up to `returned` units are paid out of tokens previously sold back to the curve.
   These are **melted** (common).
2. The remainder is issued as **fresh positions** `[cursor, cursor + n)`, and `cursor += n`.
3. Anything beyond `S` (should not happen) is melted.

### 3.3 Sell-backs: each position is issued once
Any transfer *into* the bonding-curve token account increases `returned` by the amount and
melts whatever leaves the sender (§6). Positions are never reissued: a later buyer of that
curve depth receives common tokens.

### 3.4 Reserve and migration
Any transfer out of the curve account that is not a curve buy (e.g. migration to the AMM)
delivers melted tokens. The non-saleable reserve is therefore always common.
There is no "Reserve Issue" trait.

## 4. Traits: commit and reveal

### 4.1 Reveal file
```json
{ "version": 1,
  "strikes": [ { "strike": 0, "rank": 0, "traits": ["Genesis"], "salt": "<64 hex>" }, ... ] }
```
- Exactly one entry per strike `0 … 793`, sorted by strike.
- `rank` is an integer ≥ 0. **Higher = rarer.** 0 = common. Rank drives outflow order (§6).
- Traits must not contain `|` or `,`. Salt is 32 random bytes (CSPRNG), unique per strike.
  Salts stop anyone brute-forcing the tree before reveal.

### 4.2 Hashing
- `leaf = sha256(utf8("proof:v1|" + strike + "|" + rank + "|" + traits.join(",") + "|" + salt))`
- Tree: leaves in strike order; `parent = sha256(left ‖ right)`; an odd node at any level is
  paired with itself. Root is hex.
- `fileHash = sha256(exact bytes of the published reveal file)`.

### 4.3 On-chain memos (signed by the reveal authority)
- `proof:v1:commit:<rootHex>` — valid only if posted **before the first curve buy**. Only the
  first valid commit counts. Without it there is no rarity.
- `proof:v1:reveal:<fileHashHex>` — valid only after the commit, once. The file must hash to
  `fileHash` and its leaves must reproduce the committed root; otherwise the indexer halts.

Before the reveal, every strike has rank 0.

## 5. Where rarity can live

| Place | Holds rare ranges? |
|---|---|
| **Origin account** — the token account that received positions in a curve buy | Yes, until they leave |
| **Envelope** — a vault-program token account created by `seal` | Yes, until `withdraw` |
| Anything else (other accounts, pools, the curve, exchanges) | Never. Everything there is melted. |

"Origin account" means the **token account**, not the wallet. Tokens received from anywhere
other than a curve buy are common even in an origin account.

## 6. Melt rules

Every account keeps a common (melted) balance plus a set of rare ranges.

| Event | Effect |
|---|---|
| Transfer out of an account (any destination, any route — swap, send, pool, exchange, sell-back, delegate) | Leaves in **outflow order**; the rare ranges that leave **melt**. Destination receives common tokens. |
| Transfer to self (same token account) | No-op |
| Burn | Outflow order; ranges that leave melt |
| Owner of the token account changes (`SetAuthority` AccountOwner), or the observed owner differs from the recorded one | **All** ranges in the account melt |
| `seal` with valid ranges (§7) | Named ranges move into the envelope, rarity intact |
| `seal` with invalid ranges | Treated as a plain transfer: outflow order, melt, envelope holds common tokens |
| Transfer into an envelope from outside (dust) | Envelope's common balance grows. Harmless. |
| `withdraw` | Everything in the envelope melts |

**Outflow order** (which tokens leave first):
1. The account's common balance.
2. Then rare ranges, split at strike boundaries, ordered by **rank ascending**, then
   **position descending**; within a segment, the highest positions leave first.

Before the reveal all ranks are 0, so outflow is simply highest-position-first.

## 7. Vault program (`proof_vault`)

One program handles both sealing and the collector desk. Every envelope is a PDA the program
creates, so no private key exists for it, it has no account extensions, and it is never tied
to its creator's address.

Accounts:
- `Config` PDA `["config"]`: `next_id: u64`.
- `Envelope` PDA `["envelope", id_le_u64]`: `id, holder, vault, amount, status (Sealed|Listed),
  price (lamports), ranges (≤ 8 × {start, len}), sealed_slot`.
- Vault token account PDA `["vault", envelope]`, mint = $PROOF, authority = the envelope PDA.

Instructions (account order is part of the spec — the indexer decodes by position):

| Instruction | Accounts | Effect |
|---|---|---|
| `initialize()` | payer, config, system_program | Create config once |
| `seal(ranges)` | holder★, config, envelope, vault, source, mint, token_program, system_program | Create envelope + vault; transfer `Σ len` from `source` (owned by holder) to vault; status Sealed |
| `list(price)` | holder★, envelope | Sealed → Listed, price > 0 |
| `cancel()` | holder★, envelope | Listed → Sealed |
| `buy(max_price)` | buyer★, holder, envelope, system_program | Listed; `price ≤ max_price`; pay `price` lamports buyer → holder; holder := buyer; → Sealed |
| `gift(new_holder)` | holder★, envelope | Sealed; holder := new_holder |
| `withdraw()` | holder★, envelope, vault, destination, mint, token_program | Sealed; send **entire** vault balance to destination; close vault and envelope, rent to holder. **Melts.** |

★ = signer. Program invariants:
- `mint` must equal the hard-coded `PROOF_MINT`. Token program may be SPL Token or Token-2022.
- `seal`: 1–8 ranges, each `len > 0`, sorted and non-overlapping, no overflow; vault balance
  after transfer must equal `Σ len` (rejects transfer-fee mints).
- **The only instruction that moves tokens out of a vault is `withdraw`.** Sales move the
  holder record, not the tokens.
- The program cannot see positions. Whether the named ranges were really held is decided by
  the indexer (§6 invalid seal).

Upgrade policy: upgrade authority is a public multisig with a published time delay until an
external audit, then set to none (immutable). Announced before launch.

## 8. Indexer

### 8.1 Inputs
Only finalized transactions, only successful ones (`meta.err == null`), of every transaction
version (legacy, 0 and 1 are all live on mainnet as of 2026-10). Sources to watch:
- the bonding-curve token account,
- the vault program id,
- every account that currently holds rare ranges (added when it first receives a curve buy).

Accounts without ranges never need watching: nothing in them can be rare. A newly watched
account's history before it gained ranges is irrelevant.

### 8.2 Per transaction
1. For each $PROOF token account in `preTokenBalances`: if tracked, its ledger balance
   must equal the pre-balance; otherwise start a transient entry with that balance as common.
2. Walk instructions in execution order (top-level, then inner by stack height). Classify each
   $PROOF token movement using its **direct parent** instruction:
   - source is the curve account and the parent is a pump.fun instruction not on the non-buy
     list → curve buy
   - parent is `proof_vault.seal` → seal; parent is `proof_vault.withdraw` → withdraw
   - otherwise → transfer
   Also: burns, `SetAuthority(AccountOwner)`, closes, `proof_vault` list/cancel/buy/gift,
   and memos from the reveal authority (the authority must sign the transaction).
3. For each $PROOF account in `postTokenBalances` that is tracked: ledger balance must equal
   the post-balance, and a changed owner melts its ranges.
4. Drop entries with no ranges that are not envelope vaults.

Any balance mismatch **halts** the indexer. It never guesses.

### 8.3 Ordering
Strictly by (slot, position in block). Two indexers on independent RPC providers.

### 8.4 Fingerprint
`sha256` of the canonical ledger serialization (sorted accounts, sorted ranges, decimal
strings) after a given slot. Published at fixed intervals; both indexers must match.

## 9. Checklists

### 9.1 Envelope (shown to buyers)
| Check | Program | Site/indexer |
|---|---|---|
| Mint = official $PROOF mint | ✓ | ✓ |
| Genuine token program | ✓ | ✓ |
| Envelope is a `proof_vault` PDA, vault owner = envelope PDA | ✓ | ✓ |
| Holder = seller (while listed: status Listed) | ✓ | ✓ |
| Only exit is `withdraw`, which melts | ✓ | |
| Vault balance ≥ listed ranges total | ✓ | ✓ |
| Contents match the ranges shown | | ✓ (rechecked right before the buyer signs) |
| Traits match the committed root (Merkle proof) | | ✓ (verified in the browser) |

### 9.2 Mint (verified once at launch, published)
Mint authority: none · Freeze authority: none · No permanent delegate, transfer fee, transfer
hook or frozen-by-default state (Token-2022 only).

## 10. Public wording
> Every $PROOF token trades at the same price on Jupiter. Rarity is defined by the Sequents
> rules: it survives only in the account that bought it off the curve, or sealed in a vault
> envelope. Anything that leaves either place melts into ordinary $PROOF — forever.
> A rare lot can always be withdrawn and sold as ordinary $PROOF at market price; the premium
> is the only part that depends on collectors.

## 11. Open items before launch
- Verify on the live mint: decimals, saleable supply, bonding-curve token account address
  (ATA of the PDA `["bonding-curve", mint]`). Verified 2026-10 on real pump.fun tokens: Token-2022,
  6 decimals, 1B supply, mint and freeze authority revoked, extensions `metadataPointer` +
  `tokenMetadata` only (passes §9.2). The vault's full flow is tested against such a mint.
- Re-run `devnet/pump-check.ts` against mainnet shortly before launch to catch new pump.fun
  instructions.
- Set `PROOF_MINT` and the program id in the program; set the indexer config.
- Legal review of the reveal mechanic in target jurisdictions.
- Desk fee (none in v1). Splitting envelopes (not in v1: withdraw is all-or-nothing).
