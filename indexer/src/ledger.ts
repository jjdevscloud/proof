// Deterministic rarity ledger (SPEC §3, §5, §6). Pure: no I/O.
import * as R from './ranges.ts';
import type { Range, Segment } from './ranges.ts';
import { merkleRoot, leafHash, sha256 } from './reveal.ts';
import type { RevealData } from './reveal.ts';

export type LedgerConfig = {
  curveTokenAccount: string;
  saleableSupply: bigint; // S, base units
  strikeSize: bigint; // base units
};

export type Holding = { owner: string | null; melted: bigint; ranges: Range[] };

export type EnvelopeStatus = 'sealed' | 'listed';
export type Envelope = {
  address: string; // envelope PDA
  vault: string; // vault token account
  holder: string;
  status: EnvelopeStatus;
  price: bigint; // lamports, 0 unless listed
  sealedSlot: number;
};

export type Observation = { account: string; owner: string; balance: bigint };

export type LedgerEvent =
  | { kind: 'commit'; root: string }
  | { kind: 'reveal'; fileHash: string }
  | { kind: 'curveBuy'; to: string; amount: bigint }
  | { kind: 'transfer'; from: string; to: string; amount: bigint }
  | { kind: 'burn'; from: string; amount: bigint }
  | { kind: 'ownerChange'; account: string; newOwner: string }
  | { kind: 'seal'; from: string; holder: string; envelope: string; vault: string; ranges: Range[]; amount: bigint }
  | { kind: 'list'; envelope: string; price: bigint }
  | { kind: 'cancel'; envelope: string }
  | { kind: 'sale'; envelope: string; buyer: string }
  | { kind: 'gift'; envelope: string; to: string }
  | { kind: 'withdraw'; envelope: string; to: string; amount: bigint };

export type DecodedTx = {
  slot: number;
  signature: string;
  pre: Observation[];
  post: Observation[];
  events: LedgerEvent[];
};

export type MeltReason = 'transfer' | 'sellBack' | 'burn' | 'ownerChange' | 'invalidSeal' | 'withdraw';

export type Change =
  | { kind: 'issue'; account: string; ranges: Range[] }
  | { kind: 'melt'; account: string; ranges: Range[]; reason: MeltReason }
  | { kind: 'seal'; from: string; envelope: string; ranges: Range[]; valid: boolean }
  | { kind: 'list'; envelope: string; price: bigint }
  | { kind: 'cancel'; envelope: string }
  | { kind: 'sale'; envelope: string; from: string; to: string; price: bigint }
  | { kind: 'gift'; envelope: string; from: string; to: string }
  | { kind: 'withdraw'; envelope: string; to: string }
  | { kind: 'commit'; root: string }
  | { kind: 'reveal'; fileHash: string };

export type TxChanges = { slot: number; signature: string; changes: Change[] };

export class LedgerError extends Error {}

export class Ledger {
  readonly config: LedgerConfig;
  readonly strikeCount: number;
  holdings = new Map<string, Holding>();
  envelopes = new Map<string, Envelope>();
  vaultToEnvelope = new Map<string, string>();
  curve = { cursor: 0n, returned: 0n };
  launched = false;
  commitRoot: string | null = null;
  revealHash: string | null = null;
  reveal: RevealData | null = null;
  lastSlot = 0;
  lastSignature: string | null = null;

  private registered = new Map<string, RevealData>();
  private changes: Change[] = [];
  private touched = new Set<string>();

  constructor(config: LedgerConfig) {
    this.config = config;
    this.strikeCount = Number((config.saleableSupply + config.strikeSize - 1n) / config.strikeSize);
  }

  // Makes a reveal file available; it takes effect only when the on-chain reveal memo arrives.
  registerReveal(data: RevealData, fileHash: string): void {
    this.registered.set(fileHash, data);
  }

  rank(strike: number): number {
    return this.reveal ? this.reveal.strikes[strike].rank : 0;
  }

  // Applies one finalized, successful transaction. Throws LedgerError on any inconsistency;
  // the caller must then halt and restore from a snapshot.
  applyTx(tx: DecodedTx): TxChanges {
    if (tx.slot < this.lastSlot) throw new LedgerError(`tx ${tx.signature} at slot ${tx.slot} is before ${this.lastSlot}`);
    this.changes = [];
    this.touched = new Set();
    const curve = this.config.curveTokenAccount;

    for (const o of tx.pre) {
      if (o.account === curve) continue;
      const h = this.holdings.get(o.account);
      if (h) this.expectBalance(h, o, 'pre', tx.signature);
      else this.holdings.set(o.account, { owner: o.owner, melted: o.balance, ranges: [] });
      this.touched.add(o.account);
    }

    for (const ev of tx.events) this.apply(ev, tx.slot);

    const postAccounts = new Set<string>();
    for (const o of tx.post) {
      if (o.account === curve) continue;
      postAccounts.add(o.account);
      const h = this.holdings.get(o.account);
      if (!h) continue;
      this.expectBalance(h, o, 'post', tx.signature);
      if (h.owner !== null && h.owner !== o.owner) this.meltAll(o.account, h, 'ownerChange');
      h.owner = o.owner;
    }

    for (const acct of this.touched) {
      const h = this.holdings.get(acct);
      if (!h) continue;
      if (this.vaultToEnvelope.has(acct)) continue;
      const closed = tx.pre.some((o) => o.account === acct) && !postAccounts.has(acct);
      if (closed && balance(h) !== 0n) throw new LedgerError(`${acct} closed with non-zero ledger balance in ${tx.signature}`);
      if (h.ranges.length === 0) this.holdings.delete(acct);
    }

    this.lastSlot = tx.slot;
    this.lastSignature = tx.signature;
    return { slot: tx.slot, signature: tx.signature, changes: this.changes };
  }

  private apply(ev: LedgerEvent, slot: number): void {
    const curve = this.config.curveTokenAccount;
    switch (ev.kind) {
      case 'commit':
        if (!this.launched && this.commitRoot === null) {
          this.commitRoot = ev.root;
          this.changes.push({ kind: 'commit', root: ev.root });
        }
        return;

      case 'reveal': {
        if (this.commitRoot === null || this.reveal !== null) return;
        const data = this.registered.get(ev.fileHash);
        if (!data) throw new LedgerError(`reveal ${ev.fileHash} posted on-chain but file not registered`);
        const root = merkleRoot(data.strikes.map(leafHash)).toString('hex');
        if (root !== this.commitRoot) throw new LedgerError(`reveal file root ${root} does not match commit ${this.commitRoot}`);
        if (data.strikes.length !== this.strikeCount) throw new LedgerError('reveal file has wrong strike count');
        this.reveal = data;
        this.revealHash = ev.fileHash;
        this.changes.push({ kind: 'reveal', fileHash: ev.fileHash });
        return;
      }

      case 'curveBuy': {
        this.launched = true;
        const h = this.holding(ev.to);
        const fromReturned = min(ev.amount, this.curve.returned);
        this.curve.returned -= fromReturned;
        const fresh = min(ev.amount - fromReturned, this.config.saleableSupply - this.curve.cursor);
        h.melted += ev.amount - fresh;
        if (fresh > 0n) {
          const issued = { start: this.curve.cursor, end: this.curve.cursor + fresh };
          this.curve.cursor += fresh;
          h.ranges = R.add(h.ranges, [issued]);
          this.changes.push({ kind: 'issue', account: ev.to, ranges: [issued] });
        }
        return;
      }

      case 'transfer': {
        if (ev.from === ev.to || ev.amount === 0n) return;
        if (ev.from !== curve) this.takeOut(ev.from, ev.amount, ev.to === curve ? 'sellBack' : 'transfer');
        if (ev.to === curve) this.curve.returned += ev.amount;
        else this.holding(ev.to).melted += ev.amount;
        return;
      }

      case 'burn':
        this.takeOut(ev.from, ev.amount, 'burn');
        return;

      case 'ownerChange': {
        const h = this.holding(ev.account);
        this.meltAll(ev.account, h, 'ownerChange');
        h.owner = ev.newOwner;
        return;
      }

      case 'seal': {
        if (this.envelopes.has(ev.envelope)) throw new LedgerError(`envelope ${ev.envelope} sealed twice`);
        const src = this.holding(ev.from);
        let ranges: Range[] = [];
        let valid = false;
        try {
          ranges = R.normalize(ev.ranges);
          valid = R.total(ranges) === ev.amount && ranges.every((r) => R.contains(src.ranges, r));
        } catch (e) {
          if (!(e instanceof R.RangeError)) throw e;
        }
        const vault: Holding = { owner: ev.envelope, melted: 0n, ranges: [] };
        if (valid) {
          src.ranges = R.subtract(src.ranges, ranges);
          vault.ranges = ranges;
        } else {
          this.takeOut(ev.from, ev.amount, 'invalidSeal');
          vault.melted = ev.amount;
        }
        this.holdings.set(ev.vault, vault);
        this.touched.add(ev.vault);
        this.vaultToEnvelope.set(ev.vault, ev.envelope);
        this.envelopes.set(ev.envelope, {
          address: ev.envelope, vault: ev.vault, holder: ev.holder, status: 'sealed', price: 0n, sealedSlot: slot,
        });
        this.changes.push({ kind: 'seal', from: ev.from, envelope: ev.envelope, ranges: vault.ranges, valid });
        return;
      }

      case 'list': {
        const env = this.envelope(ev.envelope);
        env.status = 'listed';
        env.price = ev.price;
        this.changes.push({ kind: 'list', envelope: ev.envelope, price: ev.price });
        return;
      }

      case 'cancel': {
        const env = this.envelope(ev.envelope);
        env.status = 'sealed';
        env.price = 0n;
        this.changes.push({ kind: 'cancel', envelope: ev.envelope });
        return;
      }

      case 'sale': {
        const env = this.envelope(ev.envelope);
        this.changes.push({ kind: 'sale', envelope: ev.envelope, from: env.holder, to: ev.buyer, price: env.price });
        env.holder = ev.buyer;
        env.status = 'sealed';
        env.price = 0n;
        return;
      }

      case 'gift': {
        const env = this.envelope(ev.envelope);
        this.changes.push({ kind: 'gift', envelope: ev.envelope, from: env.holder, to: ev.to });
        env.holder = ev.to;
        return;
      }

      case 'withdraw': {
        const env = this.envelope(ev.envelope);
        const vault = this.holdings.get(env.vault);
        if (!vault) throw new LedgerError(`vault ${env.vault} missing`);
        if (balance(vault) !== ev.amount) throw new LedgerError(`withdraw of ${ev.amount} from ${env.vault} holding ${balance(vault)}`);
        this.meltAll(env.vault, vault, 'withdraw');
        this.holding(ev.to).melted += ev.amount;
        this.holdings.delete(env.vault);
        this.vaultToEnvelope.delete(env.vault);
        this.envelopes.delete(env.address);
        this.changes.push({ kind: 'withdraw', envelope: env.address, to: ev.to });
        return;
      }
    }
  }

  // Which rare ranges would leave `account` if it sent `amount` now (SPEC §6 outflow order).
  selectOutflow(h: Holding, amount: bigint): { fromMelted: bigint; ranges: Range[] } {
    const fromMelted = min(h.melted, amount);
    let remaining = amount - fromMelted;
    const taken: Range[] = [];
    if (remaining > 0n) {
      for (const seg of this.outflowOrder(h.ranges)) {
        if (remaining === 0n) break;
        const n = min(R.len(seg), remaining);
        taken.push({ start: seg.end - n, end: seg.end });
        remaining -= n;
      }
    }
    if (remaining > 0n) throw new LedgerError(`outflow of ${amount} exceeds ledger balance ${balance(h)}`);
    return { fromMelted, ranges: taken.length ? R.normalize(taken) : [] };
  }

  outflowOrder(ranges: readonly Range[]): Segment[] {
    return R.splitByStrike(ranges, this.config.strikeSize).sort(
      (a, b) => this.rank(a.strike) - this.rank(b.strike) || (a.start > b.start ? -1 : 1),
    );
  }

  // Non-mutating preview for the sell-preview API.
  preview(account: string, amount: bigint, knownBalance?: bigint): { fromMelted: bigint; ranges: Range[] } {
    const h = this.holdings.get(account);
    if (!h) return { fromMelted: amount, ranges: [] };
    const copy = { ...h, melted: knownBalance !== undefined ? knownBalance - R.total(h.ranges) : h.melted };
    return this.selectOutflow(copy, amount);
  }

  private takeOut(account: string, amount: bigint, reason: MeltReason): void {
    const h = this.holding(account);
    const { fromMelted, ranges } = this.selectOutflow(h, amount);
    h.melted -= fromMelted;
    if (ranges.length) {
      h.ranges = R.subtract(h.ranges, ranges);
      this.changes.push({ kind: 'melt', account, ranges, reason });
    }
  }

  private meltAll(account: string, h: Holding, reason: MeltReason): void {
    if (!h.ranges.length) return;
    this.changes.push({ kind: 'melt', account, ranges: h.ranges, reason });
    h.melted += R.total(h.ranges);
    h.ranges = [];
  }

  // Accounts first seen mid-transaction (created in it) start empty.
  private holding(account: string): Holding {
    let h = this.holdings.get(account);
    if (!h) {
      h = { owner: null, melted: 0n, ranges: [] };
      this.holdings.set(account, h);
    }
    this.touched.add(account);
    return h;
  }

  private envelope(address: string): Envelope {
    const env = this.envelopes.get(address);
    if (!env) throw new LedgerError(`unknown envelope ${address}`);
    return env;
  }

  private expectBalance(h: Holding, o: Observation, when: string, sig: string): void {
    if (balance(h) !== o.balance) {
      throw new LedgerError(`${when}-balance mismatch for ${o.account} in ${sig}: ledger ${balance(h)}, chain ${o.balance}`);
    }
  }

  // ---- queries ----

  // Rare holdings of a wallet: origin accounts it owns plus envelopes it holds.
  wallet(owner: string): { accounts: { account: string; segments: Segment[] }[]; envelopes: (Envelope & { segments: Segment[] })[] } {
    const accounts: { account: string; segments: Segment[] }[] = [];
    for (const [account, h] of this.holdings) {
      if (h.owner === owner && !this.vaultToEnvelope.has(account) && h.ranges.length) {
        accounts.push({ account, segments: R.splitByStrike(h.ranges, this.config.strikeSize) });
      }
    }
    const envelopes = [...this.envelopes.values()]
      .filter((e) => e.holder === owner)
      .map((e) => ({ ...e, segments: R.splitByStrike(this.holdings.get(e.vault)?.ranges ?? [], this.config.strikeSize) }));
    return { accounts: sortBy(accounts, (a) => a.account), envelopes: sortBy(envelopes, (e) => e.address) };
  }

  // Surviving (unmelted) amount of each strike, and where it lives.
  strike(n: number): { strike: number; size: bigint; issued: bigint; surviving: bigint; pieces: { account: string; envelope: string | null; holder: string | null; amount: bigint }[] } {
    const lo = BigInt(n) * this.config.strikeSize;
    const hi = min(lo + this.config.strikeSize, this.config.saleableSupply);
    const pieces: { account: string; envelope: string | null; holder: string | null; amount: bigint }[] = [];
    let surviving = 0n;
    for (const [account, h] of this.holdings) {
      let amount = 0n;
      for (const r of h.ranges) {
        const s = r.start > lo ? r.start : lo;
        const e = r.end < hi ? r.end : hi;
        if (e > s) amount += e - s;
      }
      if (!amount) continue;
      const envelope = this.vaultToEnvelope.get(account) ?? null;
      const holder = envelope ? this.envelopes.get(envelope)!.holder : h.owner;
      pieces.push({ account, envelope, holder, amount });
      surviving += amount;
    }
    const issuedEnd = min(this.curve.cursor, hi);
    return { strike: n, size: hi - lo, issued: issuedEnd > lo ? issuedEnd - lo : 0n, surviving, pieces: sortBy(pieces, (p) => p.account) };
  }

  // ---- persistence & fingerprint ----

  toJSON(): unknown {
    return {
      version: 1,
      lastSlot: this.lastSlot,
      lastSignature: this.lastSignature,
      launched: this.launched,
      commitRoot: this.commitRoot,
      revealHash: this.revealHash,
      reveal: this.reveal,
      curve: { cursor: this.curve.cursor.toString(), returned: this.curve.returned.toString() },
      holdings: sortBy([...this.holdings], ([a]) => a).map(([account, h]) => ({
        account,
        owner: h.owner,
        melted: h.melted.toString(),
        ranges: h.ranges.map((r) => [r.start.toString(), r.end.toString()]),
      })),
      envelopes: sortBy([...this.envelopes.values()], (e) => e.address).map((e) => ({ ...e, price: e.price.toString() })),
    };
  }

  static fromJSON(config: LedgerConfig, json: any): Ledger {
    if (json.version !== 1) throw new LedgerError('unsupported snapshot version');
    const l = new Ledger(config);
    l.lastSlot = json.lastSlot;
    l.lastSignature = json.lastSignature;
    l.launched = json.launched;
    l.commitRoot = json.commitRoot;
    l.revealHash = json.revealHash;
    l.reveal = json.reveal;
    l.curve = { cursor: BigInt(json.curve.cursor), returned: BigInt(json.curve.returned) };
    for (const h of json.holdings) {
      l.holdings.set(h.account, {
        owner: h.owner,
        melted: BigInt(h.melted),
        ranges: h.ranges.map(([s, e]: [string, string]) => ({ start: BigInt(s), end: BigInt(e) })),
      });
    }
    for (const e of json.envelopes) {
      l.envelopes.set(e.address, { ...e, price: BigInt(e.price) });
      l.vaultToEnvelope.set(e.vault, e.address);
    }
    return l;
  }

  // SPEC §8.4. Only rule-relevant state; the reveal is represented by its file hash.
  fingerprint(): string {
    const j = this.toJSON() as any;
    delete j.reveal;
    delete j.lastSignature;
    return sha256(JSON.stringify(j)).toString('hex');
  }
}

export function balance(h: Holding): bigint {
  return h.melted + R.total(h.ranges);
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function sortBy<T>(xs: T[], key: (x: T) => string): T[] {
  return xs.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
