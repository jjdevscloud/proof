# $PROOF rarity

Rules: [SPEC.md](SPEC.md) — the single source of truth.

| Path | What |
|---|---|
| `programs/proof-vault` | Anchor program: seal, list, cancel, buy, gift, withdraw (SPEC §7) |
| `indexer/src/ledger.ts` | Deterministic rarity ledger — the rules (SPEC §3–6) |
| `indexer/src/decoder.ts` | Solana `jsonParsed` transaction → ledger events (SPEC §8.2) |
| `indexer/src/follower.ts` | Fetches finalized transactions in (slot, block position) order |
| `indexer/src/reveal.ts` | Commit/reveal hashing and Merkle proofs (SPEC §4) |
| `indexer/src/api.ts` | Read API + live change stream for the website |
| `web/` | Website: overview, mint sheet, strike pages with in-browser verification, collector desk, wallet actions |

## Indexer

Requires Node ≥ 23.6 (runs TypeScript directly, no build step).

```sh
cd indexer
npm install        # dev tools only (typescript, @types/node)
npm test
npm run typecheck
cp config.example.json config.json   # fill in every SET_ME
npm start
```

API: `/health`, `/wallet/:owner`, `/strike/:n`, `/strikes`, `/envelopes?status=listed`,
`/envelope/:address`, `/preview?account=&amount=[&balance=]`, `/proof/:strike`, `/stream` (SSE).

Operational behaviour:
- Writes `data/snapshot.json` after each fully applied window, `data/changes.jsonl` (history
  for strike pages), and `data/fingerprints.jsonl` (publish these; a second indexer must match).
- Any error exits the process; run it under a supervisor (systemd, pm2) that restarts it. A
  `HALT` message means a ledger inconsistency and needs a human: it will not fix itself.
- The RPC follower polls `getSignaturesForAddress` per watched account. That is fine at launch
  scale; for production volume, swap in a Geyser/Yellowstone stream feeding the same `Decoder`.

## Website

Vite + React. Talks to the indexer API for rarity data and to Solana RPC (from the browser) for
transactions and the desk's on-chain buyer checks. Wallets: Phantom, Solflare, Backpack (injected).

```sh
cd web
npm install
cp .env.example .env     # VITE_RPC_URL, VITE_CLUSTER; VITE_API_URL defaults to /api
npm run dev              # proxies /api to the indexer on :8787 (INDEXER_URL to change)
npm run build            # static site in web/dist; serve the indexer API at VITE_API_URL
```

## Program

Not yet compiled — this machine has no Rust/Solana/Anchor toolchain. To build:

```sh
# install: rustup, Solana CLI (agave), anchor 0.31.1 via avm
anchor keys sync          # sets declare_id! and Anchor.toml to your program key
# set PROOF_MINT in programs/proof-vault/src/lib.rs
anchor build && cargo test -p proof-vault
```

Before mainnet: integration tests on localnet (seal → list → buy → withdraw, wrong mint, wrong
holder, price change, Token-2022 mint), an external audit, and the upgrade policy in SPEC §7.

## Devnet test run

pump.fun is replaced by `programs/mock-curve` (same `buy` instruction name; the indexer only
needs its program id). Steps, from the repo root:

```sh
cd devnet && npm install && node keys.ts        # keypairs; points PROOF_MINT at the devnet mint
# WSL: bash scripts/wsl-build.sh && bash scripts/wsl-deploy.sh   (payer needs ~3.5 devnet SOL)
node setup.ts                                    # fund wallets, reveal file + commit, mint, curve, vault config
cd ../indexer && node src/main.ts config.devnet.json      # and config.devnet-b.json in a second terminal
cd ../devnet && node scenario.ts && node verify.ts         # every SPEC §6 rule, both indexers, fingerprints
```

`keys.ts` rewrites `PROOF_MINT` to the devnet mint — set the real mint before any mainnet build.
