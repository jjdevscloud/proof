import { Ledger } from '../src/ledger.ts';
import type { DecodedTx, LedgerEvent, Observation } from '../src/ledger.ts';
import { balance } from '../src/ledger.ts';

export const T = 1_000_000n; // base units per token
export const STRIKE = 1_000_000n * T;
export const CURVE = 'CURVE';

export function newLedger(): Ledger {
  return new Ledger({ curveTokenAccount: CURVE, saleableSupply: 793_100_000n * T, strikeSize: STRIKE });
}

// Builds a tx whose pre/post observations are consistent with the ledger's own view, so tests
// exercise the rules rather than the invariant checks. `owners` maps account -> owner.
export class Chain {
  ledger: Ledger;
  balances = new Map<string, bigint>();
  owners = new Map<string, string>();
  slot = 1;
  n = 0;

  constructor(ledger = newLedger()) {
    this.ledger = ledger;
  }

  tx(events: LedgerEvent[], opts: { ownerAfter?: Record<string, string> } = {}) {
    const accounts = new Set<string>();
    for (const e of events) for (const k of ['from', 'to', 'account', 'vault'] as const) {
      const v = (e as any)[k];
      if (typeof v === 'string' && v !== CURVE) accounts.add(v);
    }
    const pre: Observation[] = [];
    for (const a of accounts) if (this.balances.has(a)) pre.push(this.obs(a));
    for (const e of events) this.simulate(e);
    for (const [a, o] of Object.entries(opts.ownerAfter ?? {})) this.owners.set(a, o);
    const post: Observation[] = [...accounts].filter((a) => this.balances.has(a)).map((a) => this.obs(a));
    const tx: DecodedTx = { slot: this.slot++, signature: `sig${this.n++}`, pre, post, events };
    return this.ledger.applyTx(tx);
  }

  private obs(a: string): Observation {
    return { account: a, owner: this.owners.get(a) ?? `owner-of-${a}`, balance: this.balances.get(a)! };
  }

  private bump(a: string, d: bigint) {
    if (a === CURVE) return;
    this.balances.set(a, (this.balances.get(a) ?? 0n) + d);
  }

  private simulate(e: LedgerEvent) {
    switch (e.kind) {
      case 'curveBuy': this.bump(e.to, e.amount); break;
      case 'transfer': this.bump(e.from, -e.amount); this.bump(e.to, e.amount); break;
      case 'burn': this.bump(e.from, -e.amount); break;
      case 'donate': this.bump(e.from, -e.amount); break;
      case 'seal': this.bump(e.from, -e.amount); this.bump(e.vault, e.amount); this.owners.set(e.vault, e.envelope); break;
      case 'withdraw': {
        const env = this.ledger.envelopes.get(e.envelope)!;
        this.bump(e.to, e.amount);
        this.balances.delete(env.vault);
        break;
      }
      case 'ownerChange': this.owners.set(e.account, e.newOwner); break;
    }
  }
}

export function ledgerBalance(l: Ledger, a: string): bigint {
  const h = l.holdings.get(a);
  return h ? balance(h) : 0n;
}

export const r = (start: bigint, end: bigint) => ({ start, end });
