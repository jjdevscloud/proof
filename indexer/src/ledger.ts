// Deterministic rarity ledger (SPEC §3, §5, §6). Pure: no I/O.
import * as R from './ranges.ts';
import type { Range, Segment } from './ranges.ts';
import { sha256 } from './reveal.ts';
import type { RevealData } from './reveal.ts';
import { deriveTraits, parseRules, rollResult } from './derive.ts';
import type { RollResult, RollRules } from './derive.ts';

// The seed block comes this many slots after the curve sells its last position (SPEC §4.3).
export const SEED_DELAY_SLOTS = 150;

export type LedgerConfig = {
  curveTokenAccount: string;
  saleableSupply: bigint; // S, base units
  strikeSize: bigint; // base units
  roll?: RollRules; // from the rules file; must equal the committed rules' roll section
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
  roll: (RollResult & { signature: string }) | null; // latest roll result (SPEC §4.5)
  rolling: { signature: string; slot: number; seedSlot: number } | null; // paid roll awaiting its seed block
};

export type Observation = { account: string; owner: string; balance: bigint };

export type LedgerEvent =
  | { kind: 'commit'; root: string; deadlineSlot: number }
  | { kind: 'reveal'; fileHash: string }
  | { kind: 'curveBuy'; to: string; amount: bigint }
  | { kind: 'transfer'; from: string; to: string; amount: bigint }
  | { kind: 'burn'; from: string; amount: bigint }
  | { kind: 'donate'; from: string; amount: bigint } // into the curve token account outside a pump.fun instruction
  | { kind: 'ownerChange'; account: string; newOwner: string }
  | { kind: 'seal'; from: string; holder: string; envelope: string; vault: string; ranges: Range[]; amount: bigint }
  | { kind: 'list'; envelope: string; price: bigint }
  | { kind: 'cancel'; envelope: string }
  | { kind: 'sale'; envelope: string; buyer: string }
  | { kind: 'gift'; envelope: string; to: string }
  | { kind: 'withdraw'; envelope: string; to: string; amount: bigint }
  | { kind: 'roll'; envelope: string } // memo proof:v1:roll:<envelope>
  | { kind: 'lamports'; from: string; to: string; lamports: bigint }; // system transfer to the roll treasury

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
  | { kind: 'seal'; from: string; envelope: string; ranges: Range[]; valid: boolean; ordinary?: bigint }
  | { kind: 'list'; envelope: string; price: bigint }
  | { kind: 'cancel'; envelope: string }
  | { kind: 'sale'; envelope: string; from: string; to: string; price: bigint }
  | { kind: 'gift'; envelope: string; from: string; to: string }
  | { kind: 'withdraw'; envelope: string; to: string }
  | { kind: 'commit'; root: string; deadlineSlot: number }
  | { kind: 'reveal'; fileHash: string }
  | { kind: 'roll'; envelope: string; holder: string; valid: boolean; reason?: string }
  | { kind: 'rolled'; envelope: string; holder: string; name: string; points: number; seedSlot: number; blockhash: string };

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
  deadlineSlot: number | null = null; // from the commit memo
  completionSlot: number | null = null; // slot of the curve buy that issued the last position
  seedFixedAt: number | null = null; // the seed target slot, once passed
  seedCursor: bigint | null = null; // curve cursor at the seed target slot
  revealHash: string | null = null;
  reveal: RevealData | null = null;
  lastSlot = 0;
  lastSignature: string | null = null;

  private registered = new Map<string, RevealData>();
  private changes: Change[] = [];
  private touched = new Set<string>();
  private rollFees = new Map<string, bigint>(); // lamports paid to the roll treasury in the current tx, by payer
  private rolledInTx = false;
  private currentSignature = '';

  constructor(config: LedgerConfig) {
    this.config = config;
    this.strikeCount = Number((config.saleableSupply + config.strikeSize - 1n) / config.strikeSize);
  }

  // Makes a reveal file available; it takes effect only when the on-chain reveal memo arrives.
  registerReveal(data: RevealData, fileHash: string): void {
    this.registered.set(fileHash, data);
  }

  // min(completion + SEED_DELAY_SLOTS, deadline); null before the commit.
  seedTarget(): number | null {
    if (this.deadlineSlot === null) return null;
    return this.completionSlot === null ? this.deadlineSlot : Math.min(this.completionSlot + SEED_DELAY_SLOTS, this.deadlineSlot);
  }

  // Strikes fully sold when the seed target slot passed: the only ones that can receive errors.
  // A Strike is fully sold when all its positions are issued; the short final Strike counts once
  // the curve has issued every saleable position.
  eligibleStrikes(): number | null {
    if (this.seedCursor === null) return null;
    if (this.seedCursor >= this.config.saleableSupply) return this.strikeCount;
    return Number(this.seedCursor / this.config.strikeSize);
  }

  // Called once every relevant transaction up to and including `slot` has been applied. If the
  // seed target slot has passed with no later transaction, the cursor cannot have moved since.
  passedSlot(slot: number): void {
    const target = this.seedTarget();
    if (this.seedCursor === null && target !== null && slot > target) {
      this.seedCursor = this.curve.cursor;
      this.seedFixedAt = target;
    }
  }

  rank(strike: number): number {
    return this.reveal ? this.reveal.strikes[strike].rank : 0;
  }

  // Applies one finalized, successful transaction. Throws LedgerError on any inconsistency;
  // the caller must then halt and restore from a snapshot.
  applyTx(tx: DecodedTx): TxChanges {
    this.currentSignature = tx.signature;
    if (tx.slot < this.lastSlot) throw new LedgerError(`tx ${tx.signature} at slot ${tx.slot} is before ${this.lastSlot}`);
    this.changes = [];
    this.touched = new Set();
    this.rollFees = new Map();
    this.rolledInTx = false;
    for (const ev of tx.events) {
      if (ev.kind === 'lamports' && ev.to === this.config.roll?.treasury) this.rollFees.set(ev.from, (this.rollFees.get(ev.from) ?? 0n) + ev.lamports);
    }
    const curve = this.config.curveTokenAccount;

    // Fix the seed point as soon as a transaction lands after the seed target slot: nothing in
    // between could change the cursor, because nothing happened.
    const target = this.seedTarget();
    if (this.seedCursor === null && target !== null && tx.slot > target) {
      this.seedCursor = this.curve.cursor;
      this.seedFixedAt = target;
    }

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
        if (!this.launched && this.commitRoot === null && ev.deadlineSlot > slot) {
          this.commitRoot = ev.root;
          this.deadlineSlot = ev.deadlineSlot;
          this.changes.push({ kind: 'commit', root: ev.root, deadlineSlot: ev.deadlineSlot });
        }
        return;

      case 'reveal': {
        // Only after the seed point is fixed; earlier reveal memos are ignored.
        if (this.commitRoot === null || this.reveal !== null || this.seedCursor === null) return;
        const data = this.registered.get(ev.fileHash);
        if (!data) throw new LedgerError(`reveal ${ev.fileHash} posted on-chain but file not registered`);
        const fail = (why: string) => {
          throw new LedgerError(`reveal ${ev.fileHash} rejected: ${why}`);
        };
        if (sha256(data.rules).toString('hex') !== this.commitRoot) fail('rules file does not match the commitment');
        const rules = parseRules(data.rules);
        if (rules.deadlineSlot !== this.deadlineSlot) fail('deadline differs from the commit memo');
        if (rules.strikeCount !== this.strikeCount || BigInt(rules.strikeSize) !== this.config.strikeSize) fail('strike size or count differs from the indexer');
        if (JSON.stringify(rules.roll ?? null) !== JSON.stringify(this.config.roll ?? null)) fail('roll rules differ from the ones the indexer applied');
        if (data.seedTargetSlot !== this.seedFixedAt) fail(`seed target slot ${data.seedTargetSlot}, ledger says ${this.seedFixedAt}`);
        if (data.eligibleStrikes !== this.eligibleStrikes()) fail(`eligible strikes ${data.eligibleStrikes}, ledger says ${this.eligibleStrikes()}`);
        if (JSON.stringify(data.strikes) !== JSON.stringify(deriveTraits(rules, data.blockhash, data.eligibleStrikes))) fail('traits do not follow from the seed');
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
          if (this.curve.cursor === this.config.saleableSupply && this.completionSlot === null) this.completionSlot = slot;
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

      case 'donate':
        // Leaves the sender (melts) but never returns to the curve's saleable stock.
        if (ev.from !== curve) this.takeOut(ev.from, ev.amount, 'transfer');
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
        // Declared ranges entirely past the saleable supply: a deliberate seal of ordinary $PROOF.
        const ordinary = ev.ranges.length > 0 && ev.ranges.every((r) => r.start >= this.config.saleableSupply);
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
          address: ev.envelope, vault: ev.vault, holder: ev.holder, status: 'sealed', price: 0n, sealedSlot: slot, roll: null, rolling: null,
        });
        this.changes.push({ kind: 'seal', from: ev.from, envelope: ev.envelope, ranges: vault.ranges, valid, ...(ordinary && !valid ? { ordinary: ev.amount } : {}) });
        return;
      }

      case 'roll': {
        // One roll per transaction; the first roll memo counts. Invalid rolls are recorded but do
        // nothing (the fee is not refunded; the website checks everything before sending).
        const rules = this.config.roll;
        const env = this.envelopes.get(ev.envelope);
        if (!rules || !env || this.rolledInTx) return;
        this.rolledInTx = true;
        const reject = (reason: string) => void this.changes.push({ kind: 'roll', envelope: env.address, holder: env.holder, valid: false, reason });
        const vault = this.holdings.get(env.vault);
        if (env.status !== 'sealed') return reject('envelope is listed');
        if (env.rolling) return reject('a roll is already in progress');
        if (env.roll && env.roll.points > 0) return reject('envelope already holds a rare roll');
        if (!vault || vault.ranges.length) return reject('envelope holds rare Strikes');
        if (vault.melted < BigInt(rules.minEntry)) return reject('envelope holds less than the minimum');
        if ((this.rollFees.get(env.holder) ?? 0n) < BigInt(rules.feeLamports)) return reject('fee not paid by the holder');
        env.rolling = { signature: this.currentSignature, slot, seedSlot: slot + rules.seedDelaySlots };
        this.changes.push({ kind: 'roll', envelope: env.address, holder: env.holder, valid: true });
        return;
      }

      case 'lamports':
        return; // summed up front (rollFees)

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

  // Rolls whose seed slot is at or before `slot`, i.e. whose seed block exists once `slot` is reached.
  dueRolls(slot: number): Envelope[] {
    return sortBy([...this.envelopes.values()].filter((e) => e.rolling && e.rolling.seedSlot <= slot), (e) => e.address);
  }

  // Settles a pending roll with its seed block: the first block at or after its seed slot. Applied
  // before any transaction at or after that slot, so every indexer settles at the same point.
  settleRoll(envelope: string, blockSlot: number, blockhash: string): TxChanges {
    const env = this.envelope(envelope);
    const rules = this.config.roll;
    if (!env.rolling || !rules) throw new LedgerError(`no roll pending for ${envelope}`);
    if (blockSlot < env.rolling.seedSlot) throw new LedgerError(`seed block ${blockSlot} before seed slot ${env.rolling.seedSlot}`);
    const { signature } = env.rolling;
    const result = rollResult(rules, signature, blockhash);
    env.roll = { ...result, signature };
    env.rolling = null;
    return {
      slot: blockSlot,
      signature,
      changes: [{ kind: 'rolled', envelope, holder: env.holder, name: result.name, points: result.points, seedSlot: blockSlot, blockhash }],
    };
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
      deadlineSlot: this.deadlineSlot,
      completionSlot: this.completionSlot,
      seedFixedAt: this.seedFixedAt,
      seedCursor: this.seedCursor === null ? null : this.seedCursor.toString(),
      revealHash: this.revealHash,
      reveal: this.reveal,
      curve: { cursor: this.curve.cursor.toString(), returned: this.curve.returned.toString() },
      holdings: sortBy([...this.holdings], ([a]) => a).map(([account, h]) => ({
        account,
        owner: h.owner,
        melted: h.melted.toString(),
        ranges: h.ranges.map((r) => [r.start.toString(), r.end.toString()]),
      })),
      envelopes: sortBy([...this.envelopes.values()], (e) => e.address).map((e) => ({
        address: e.address, vault: e.vault, holder: e.holder, status: e.status, price: e.price.toString(), sealedSlot: e.sealedSlot,
        roll: e.roll, rolling: e.rolling,
      })),
    };
  }

  static fromJSON(config: LedgerConfig, json: any): Ledger {
    if (json.version !== 1) throw new LedgerError('unsupported snapshot version');
    const l = new Ledger(config);
    l.lastSlot = json.lastSlot;
    l.lastSignature = json.lastSignature;
    l.launched = json.launched;
    l.commitRoot = json.commitRoot;
    l.deadlineSlot = json.deadlineSlot ?? null;
    l.completionSlot = json.completionSlot ?? null;
    l.seedFixedAt = json.seedFixedAt ?? null;
    l.seedCursor = json.seedCursor === null || json.seedCursor === undefined ? null : BigInt(json.seedCursor);
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
      l.envelopes.set(e.address, { roll: null, rolling: null, ...e, price: BigInt(e.price) });
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
