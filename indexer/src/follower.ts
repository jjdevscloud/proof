// Feeds finalized transactions to the ledger in (slot, block position) order (SPEC §8.1, §8.3).
//
// Only a few addresses matter: the curve token account, the vault program, the reveal authority,
// and accounts that currently hold rare ranges. When a transaction gives a new account ranges,
// that account's later transactions in the current window are fetched and merged into the queue
// before anything after it is applied. Its earlier history is irrelevant (it held no ranges).
import type { Ledger, TxChanges } from './ledger.ts';
import type { Decoder } from './decoder.ts';
import type { Rpc } from './rpc.ts';

export type FollowerConfig = {
  curveTokenAccount: string;
  vaultProgramId: string;
  revealAuthority: string;
  maxWindowSlots: number;
  rollTreasury?: string; // every roll pays it, so its transactions include every roll
};

type Queued = { signature: string; slot: number };

export class Follower {
  syncedSlot: number;
  finalizedSlot = 0; // chain tip seen by the last sync; syncedSlot < finalizedSlot means catching up
  private ledger: Ledger;
  private decoder: Decoder;
  private rpc: Rpc;
  private config: FollowerConfig;
  private blockOrders = new Map<number, string[]>();

  constructor(ledger: Ledger, decoder: Decoder, rpc: Rpc, config: FollowerConfig, syncedSlot: number) {
    this.ledger = ledger;
    this.decoder = decoder;
    this.rpc = rpc;
    this.config = config;
    this.syncedSlot = syncedSlot;
  }

  private watched(): Set<string> {
    const extra = this.config.rollTreasury ? [this.config.rollTreasury] : [];
    return new Set([this.config.curveTokenAccount, this.config.vaultProgramId, this.config.revealAuthority, ...extra, ...this.ledger.holdings.keys()]);
  }

  // Processes one window up to the finalized slot. Returns the number of transactions applied.
  async syncOnce(onChanges: (c: TxChanges) => void): Promise<number> {
    const finalized = await this.rpc.finalizedSlot();
    this.finalizedSlot = finalized;
    const from = this.syncedSlot + 1;
    const to = Math.min(finalized, from + this.config.maxWindowSlots - 1);
    if (to < from) return 0;

    const queue = new Map<string, Queued>();
    const seen = new Set<string>();
    const enqueue = async (address: string, fromSlot: number): Promise<Queued[]> => {
      const added: Queued[] = [];
      for (const s of await this.rpc.signatures(address, fromSlot, to)) {
        if (s.err !== null || seen.has(s.signature) || queue.has(s.signature)) continue;
        const q = { signature: s.signature, slot: s.slot };
        queue.set(s.signature, q);
        added.push(q);
      }
      return added;
    };
    for (const a of this.watched()) await enqueue(a, from);

    let applied = 0;
    while (queue.size) {
      const next = await this.earliest(queue);
      queue.delete(next.signature);
      seen.add(next.signature);
      // Rolls whose seed block is this transaction's block or earlier settle before it.
      await this.settleRolls(next.slot, onChanges);

      const before = new Set(this.ledger.holdings.keys());
      const raw = await this.rpc.transaction(next.signature);
      const decoded = this.decoder.decode(raw);
      if (!decoded) continue;
      onChanges(this.ledger.applyTx(decoded));
      applied++;

      for (const a of this.ledger.holdings.keys()) {
        if (before.has(a)) continue;
        const added = await enqueue(a, next.slot);
        // The new account's transactions earlier in this slot predate its ranges: irrelevant.
        if (added.some((q) => q.slot === next.slot)) {
          const order = await this.order(next.slot);
          const pos = order.indexOf(next.signature);
          for (const q of added) {
            if (q.slot === next.slot && order.indexOf(q.signature) < pos) queue.delete(q.signature);
          }
        }
      }
    }
    await this.settleRolls(to, onChanges);
    this.ledger.passedSlot(to);
    this.syncedSlot = to;
    this.blockOrders.clear();
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

  private async earliest(queue: Map<string, Queued>): Promise<Queued> {
    let min = Infinity;
    for (const q of queue.values()) min = Math.min(min, q.slot);
    const sameSlot = [...queue.values()].filter((q) => q.slot === min);
    if (sameSlot.length === 1) return sameSlot[0];
    const order = await this.order(min);
    sameSlot.sort((a, b) => order.indexOf(a.signature) - order.indexOf(b.signature));
    return sameSlot[0];
  }

  private async order(slot: number): Promise<string[]> {
    let o = this.blockOrders.get(slot);
    if (!o) {
      o = await this.rpc.blockOrder(slot);
      this.blockOrders.set(slot, o);
    }
    return o;
  }
}
