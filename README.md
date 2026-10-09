# Sequents

The collector ledger for the $PROOF token: rare token ranges, sealed envelopes and a collector desk.

Rules: [SPEC.md](SPEC.md) — the single source of truth.

| Path | What |
|---|---|
| `programs/proof-vault` | Anchor program: seal, list, cancel, buy, gift, withdraw (SPEC §7) |
| `indexer/src/ledger.ts` | Deterministic rarity ledger — the rules (SPEC §3–6) |
| `indexer/src/decoder.ts` | Solana `jsonParsed` transaction → ledger events (SPEC §8.2) |
| `indexer/src/follower.ts` | Fetches finalized transactions in (slot, block position) order |
| `indexer/src/derive.ts` | Trait assignment from the public seed — shared by the indexer and the browser (SPEC §4) |
| `indexer/src/reveal.ts` | Reveal file format and checks |
| `rules/` | The approved Sequents rarity rules (template; the final file is committed on-chain) |
| `ops/` | Launch tools: `make-commit.ts` (before the token exists), `launch.ts` (the moment it exists), `make-reveal.ts` (after the seed point) |
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

Built in WSL Ubuntu (`scripts/wsl-setup.sh` installs Rust, Agave 2.1 and Anchor 0.31.1):

```sh
bash scripts/wsl-build.sh     # devnet/test build (feature "devnet"), MSRV-pinned Cargo.lock, unit tests
bash scripts/wsl-deploy.sh    # deploy both programs with devnet/keys/payer.json
bash scripts/wsl-mainnet-deploy.sh <SQUADS_VAULT>   # mainnet build + deploy, before the token exists
```

The program does not contain the mint. It is recorded once, right after the token is created, by
`set_mint`, which only `LAUNCH_AUTHORITY` may call (mainnet: the deployer wallet; devnet builds: the
devnet payer).

Before mainnet: an external audit and the upgrade policy in SPEC §7.

## Devnet test run

pump.fun is replaced by `programs/mock-curve` (same `buy` instruction name; the indexer only
needs its program id). Steps, from the repo root:

```sh
cd devnet && npm install && node keys.ts        # keypairs
# WSL: bash scripts/wsl-build.sh && bash scripts/wsl-deploy.sh   (payer needs ~3.5 devnet SOL)
node setup.ts                                    # fund wallets, rules + commit, mint, curve, vault config, set_mint
cd ../indexer && node src/main.ts config.devnet.json      # and config.devnet-b.json in a second terminal
cd ../devnet && node scenario.ts && node verify.ts         # every SPEC §6 rule, both indexers, fingerprints
node attacks.ts                                  # 17 misuse/attack cases + happy path, simulated (no state change)
node pump-check.ts 200                           # decoder vs REAL mainnet pump.fun transactions (read-only)
# Full pipeline on a local validator (WSL: bash scripts/wsl-localnet.sh), then with RPC_URL=http://127.0.0.1:8899:
#   node setup.ts; start indexer with config.localnet.json (+ -b); node scenario.ts; node verify.ts
#   node token2022-local.ts   # vault flow on a pump.fun-style Token-2022 mint (fresh validator)
#   node launch-guard.ts      # only the launch authority can record the mint (fresh validator)
```

The website shows a devnet-only "Get test tokens" panel on your own wallet page (mock curve buy).


## Mainnet launch

Everything is deployed before the token exists, so the site goes live within seconds of creation.

Before launch day (once):
1. `bash scripts/wsl-mainnet-deploy.sh <SQUADS_VAULT>` (WSL): deploy the vault program, hand upgrade authority to Squads.
2. `node ops/init-vault.ts --program <id> --key <deployer.json>`: create the vault config account.

Launch day, before the token:
3. `node ops/make-commit.ts ... --key <reveal-authority.json> --post`: posts the commit memo and writes
   `rules/sequents-v1.json` and the indexer `startSlot`.
4. Commit, `railway up`. The site is still "Launching soon"; its server now watches for the mint.
5. `cd ops && node launch.ts --watch <your creator wallet> --key <deployer.json>`: leave it running.

The moment:
6. Create the token on pump.fun. `launch.ts` sees it, checks it against the rules and records it
   (`set_mint`); the server re-checks it and goes live, and open pages switch without a reload.
   If `launch.ts` was not running, run it with `--mint <mint>` instead.

The server keeps the launch in `/data/launch.json`. Putting the mint into `indexer/config.mainnet.json`
later is optional.
