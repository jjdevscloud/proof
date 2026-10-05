# Sequents website — frontend guide

Vite + React + TypeScript. One stylesheet, no UI framework.

- **Live site:** https://sequents-production.up.railway.app (shows "Launching soon" until the token exists)
- **Every page with demo data:** https://sequents-production.up.railway.app/preview/ (yellow banner; nothing is real, no transactions)

## Run it locally

```sh
cd web
npm install
npm run dev:demo      # http://localhost:5173 — every page with demo data, demo wallet, no setup needed
```

Edits show up instantly. `npm run dev` runs against a real indexer instead (see the root README).
Before pushing: `npm run typecheck` must pass.

## Pages

Hash routes, so every page is one `index.html`.

| Route | File | What it shows |
|---|---|---|
| `#/` | `src/pages/Overview.tsx` | Hero, live stats, the mint sheet, survival by rarity, live activity |
| (pre-launch) | `src/pages/Prelaunch.tsx` | "Launching soon": rarity table with odds, launch steps |
| `#/strikes` | `src/pages/Strikes.tsx` | Mint sheet with filters, list of the rarest Strikes |
| `#/strike/:n` | `src/pages/Strike.tsx` | One Strike: traits, survival, holders, history, **Verify** panel |
| `#/desk` | `src/pages/Desk.tsx` | Listed envelopes; **Review & buy** modal with safety checks |
| `#/wallet`, `#/wallet/:address` | `src/pages/Wallet.tsx` | Rare tokens, seal / sell preview, envelopes: list, gift, withdraw |
| `#/rules` | `src/pages/Rules.tsx` | Plain-language explanation |

The header, navigation, wallet menu and footer are in `src/App.tsx`.

## Building blocks

| File | Contents |
|---|---|
| `src/components/ui.tsx` | `StrikeCoin`, `Traits`, `SegmentList`, `Addr`, `Stat`, `Bar`, `Modal`, `TypedConfirm`, transaction toasts |
| `src/components/MintSheet.tsx` | The 794-cell grid + legend |
| `src/components/Activity.tsx` | Activity feed and the wording of every event |
| `src/format.ts` | Number, token, SOL and address formatting; rarity tiers |
| `src/styles.css` | **All styling.** Design tokens (colours, fonts, radius, tier colours) are at the top, with dark-mode values right below |

Data comes from `src/api.ts` (`useApi('/path')`); the response shapes are the types in that file.
In demo mode the same calls are answered by `src/demo.ts`, so new UI can be built against demo data first.

## Please don't change without a review

These are security-relevant; visual changes around them are fine, logic changes are not:

- `src/chain.ts` — wallet connection and transaction building (account order must match the on-chain program)
- `src/verify.ts` and `../indexer/src/derive.ts` — the in-browser verification of the reveal
- The safety checks in the Desk modal and the typed confirmations (`MELT`, `GIFT`)

## Checklist for changes

- Works in **light and dark** mode (it follows the system setting).
- Works at **phone width** (~390 px) with no sideways scrolling.
- `npm run typecheck` passes; `npm run build` and `npm run build:demo` succeed.
- Work on a branch and open a pull request against `main`.

## How changes go live

The site is one Railway service (website + API + Solana proxy). After a change is merged to
`main`, it's deployed with `railway up` from the repo root. The `/preview` copy is rebuilt in
the same deploy.
