// Feeds finalized transactions to the ledger in (slot, block position) order (SPEC §8.1, §8.3).
//
// Per window it fetches the signatures of a few fixed addresses: the curve token account, the
// vault program, the reveal authority, the roll treasury and the $PROOF mint (every transferChecked,
// swap or burn of the token names the mint). Holders are not queried one by one: their on-chain
// balances and owners are read in batches and compared with the ledger, and only accounts that
// differ are asked for their history. Accounts that receive their first ranges in the window (curve
// buyers) have their window history fetched too. Transactions are fetched in parallel and applied
// strictly in chain order. Applying an extra transaction is harmless; missing one that touches a
// ranged account is not, and the ledger halts on the next balance mismatch if that ever happens.
import type { DecodedTx, Ledger, TxChanges } from './ledger.ts';
import { balance } from './ledger.ts';
import type { Decoder } from './decoder.ts';
import type { Rpc } from './rpc.ts';

export type FollowerConfig = {
  curveTokenAccount: string;
  vaultProgramId: string;
  revealAuthority: string;
  maxWindowSlots: number;
  mint?: string;
  rollTreasury?: string; // every roll pays it, so its transactions include every roll
  rpcConcurrency?: number; // parallel RPC requests (default 8); the client backs off on 429
};

const BATCH = 100; // getMultipleAccounts limit

export class Follower {
  syncedSlot: number;
  finalizedSlot = 0; // chain tip seen by the last sync; syncedSlot < finalizedSlot means catching up
  private ledger: Ledger;
  private decoder: Decoder;
  private rpc: Rpc;
  private config: FollowerConfig;

  constructor(ledger: Ledger, decoder: Decoder, rpc: Rpc, config: FollowerConfig, syncedSlot: number) {
    this.ledger = ledger;
    this.decoder = decoder;
    this.rpc = rpc;
    this.config = config;
    this.syncedSlot = syncedSlot;
  }

  private fixed(): string[] {
    const c = this.config;
    return [c.curveTokenAccount, c.vaultProgramId, c.revealAuthority, c.rollTreasury, c.mint].filter((a): a is string => !!a);
  }

  // Runs `fn` over `items` with at most `rpcConcurrency` in flight.
  private async pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.config.rpcConcurrency ?? 8, items.length) }, worker));
    return out;
  }

  // Ranged accounts whose on-chain balance or owner differs from the ledger: they moved in a
  // transaction the fixed addresses did not show (e.g. a plain transfer without the mint).
  private async changedHolders(): Promise<string[]> {
    const accounts = [...this.ledger.holdings.keys()];
    const batches: string[][] = [];
    for (let i = 0; i < accounts.length; i += BATCH) batches.push(accounts.slice(i, i + BATCH));
    const results = await this.pool(batches, (b) => this.rpc.multipleTokenAccounts(b));
    const changed: string[] = [];
    batches.forEach((b, bi) => b.forEach((account, i) => {
      const h = this.ledger.holdings.get(account)!;
      const chain = results[bi][i];
      if (!chain || chain.amount !== balance(h) || chain.owner !== h.owner) changed.push(account);
    }));
    return changed;
  }

  // Processes one window up to the finalized slot. Returns the number of transactions applied.
  async syncOnce(onChanges: (c: TxChanges) => void): Promise<number> {
    const finalized = await this.rpc.finalizedSlot();
    this.finalizedSlot = finalized;
    const from = this.syncedSlot + 1;
    const to = Math.min(finalized, from + this.config.maxWindowSlots - 1);
    if (to < from) return 0;

    const slots = new Map<string, number>(); // signature -> slot
    const queried = new Set<string>();
    const collect = async (addresses: string[]) => {
      const fresh = addresses.filter((a) => !queried.has(a));
      fresh.forEach((a) => queried.add(a));
      for (const list of await this.pool(fresh, (a) => this.rpc.signatures(a, from, to))) {
        for (const s of list) if (s.err === null) slots.set(s.signature, s.slot);
      }
    };
    const decoded = new Map<string, DecodedTx | null>();
    const fetchAll = async () => {
      const missing = [...slots.keys()].filter((s) => !decoded.has(s));
      const txs = await this.pool(missing, (s) => this.rpc.transaction(s));
      missing.forEach((s, i) => decoded.set(s, this.decoder.decode(txs[i])));
    };

    await collect(this.fixed());
    await collect(await this.changedHolders());
    await fetchAll();
    // Accounts that receive ranges in this window: their window history matters from then on.
    const buyers = new Set<string>();
    for (const d of decoded.values()) {
      for (const ev of d?.events ?? []) if (ev.kind === 'curveBuy' && !this.ledger.holdings.has(ev.to)) buyers.add(ev.to);
    }
    await collect([...buyers]);
    await fetchAll();

    // Chain order: by slot, then position in the block for slots with several transactions.
    const bySlot = new Map<number, string[]>();
    for (const [sig, slot] of slots) bySlot.set(slot, [...(bySlot.get(slot) ?? []), sig]);
    const multi = [...bySlot].filter(([, sigs]) => sigs.length > 1).map(([slot]) => slot);
    const orders = new Map<number, Map<string, number>>();
    (await this.pool(multi, (slot) => this.rpc.blockOrder(slot))).forEach((order, i) => {
      orders.set(multi[i], new Map(order.map((s, pos) => [s, pos])));
    });
    const sequence = [...slots].sort(([a, sa], [b, sb]) => sa - sb || (orders.get(sa)?.get(a) ?? 0) - (orders.get(sb)?.get(b) ?? 0));

    let applied = 0;
    for (const [sig, slot] of sequence) {
      // Rolls whose seed block is this transaction's block or earlier settle before it.
      await this.settleRolls(slot, onChanges);
      const d = decoded.get(sig);
      if (!d) continue;
      onChanges(this.ledger.applyTx(d));
      applied++;
    }
    await this.settleRolls(to, onChanges);
    this.ledger.passedSlot(to);
    this.syncedSlot = to;
    return applied;
  }

  // Settles every pending roll whose seed block exists at or before `slot` (SPEC §4.5).
  private async settleRolls(slot: number, onChanges: (c: TxChanges) => void): Promise<void> {
    for (const env of this.ledger.dueRolls(slot)) {
      const block = await this.rpc.firstBlockFrom(env.rolling!.seedSlot);
      if (!block || block.slot > slot) continue; // seed block not finalized yet
      onChanges(this.ledger.settleRoll(env.address, block.slot, block.blockhash));
    }
  }
}
