// Trait assignment from a public seed (SPEC §4). Pure, synchronous and dependency-free so the
// indexer and every visitor's browser run exactly the same code.

export type DateTier = { name: string; from: number; to: number; points: number };
export type ErrorTrait = { name: string; count: number; points: number };
export type Rules = {
  version: 1;
  project: string;
  token: string;
  strikeSize: string; // base units, decimal string
  strikeCount: number;
  deadlineSlot: number; // the seed block is chosen no later than this (SPEC §4.3)
  dates: DateTier[]; // positional tiers, non-overlapping
  defaultDate: { name: string; points: number };
  errors: ErrorTrait[]; // random, at most one per Strike, assigned in this order
};
export type StrikeTraits = { strike: number; rank: number; traits: string[] };

export class RulesError extends Error {}

const NAME_OK = /^[A-Za-z0-9 '\-]+$/;

export function parseRules(text: string): Rules {
  let r: Rules;
  try {
    r = JSON.parse(text);
  } catch {
    throw new RulesError('rules file is not valid JSON');
  }
  const int = (v: unknown, what: string, min = 0) => {
    if (!Number.isSafeInteger(v) || (v as number) < min) throw new RulesError(`${what} must be an integer ≥ ${min}`);
  };
  if (r.version !== 1) throw new RulesError('unsupported rules version');
  int(r.strikeCount, 'strikeCount', 1);
  int(r.deadlineSlot, 'deadlineSlot', 1);
  if (!/^[1-9][0-9]*$/.test(r.strikeSize)) throw new RulesError('strikeSize must be a positive decimal string');
  const name = (n: string) => {
    if (typeof n !== 'string' || !NAME_OK.test(n)) throw new RulesError(`bad trait name "${n}"`);
  };
  name(r.defaultDate?.name);
  int(r.defaultDate.points, 'defaultDate.points');
  const taken = new Set<number>();
  for (const d of r.dates) {
    name(d.name);
    int(d.from, `${d.name}.from`);
    int(d.to, `${d.name}.to`);
    int(d.points, `${d.name}.points`);
    if (d.to < d.from || d.to >= r.strikeCount) throw new RulesError(`${d.name}: range ${d.from}-${d.to} out of bounds`);
    for (let s = d.from; s <= d.to; s++) {
      if (taken.has(s)) throw new RulesError(`date tiers overlap at Strike ${s}`);
      taken.add(s);
    }
  }
  for (const e of r.errors) {
    name(e.name);
    int(e.count, `${e.name}.count`, 1);
    int(e.points, `${e.name}.points`);
  }
  return r;
}

// Seed = sha256("sequents:v1:seed|" + blockhash) where blockhash is the base58 hash of the seed block.
export function seedFrom(blockhash: string): Uint8Array {
  return sha256(utf8(`sequents:v1:seed|${blockhash}`));
}

// Deterministic, uniform random integers from SHA-256 in counter mode, with rejection sampling.
class Stream {
  private seed: Uint8Array;
  private block: Uint8Array = new Uint8Array(0);
  private off = 32;
  private counter = 0;
  constructor(seed: Uint8Array) {
    this.seed = seed;
  }
  private u32(): number {
    if (this.off >= 32) {
      const input = new Uint8Array(this.seed.length + 4);
      input.set(this.seed);
      new DataView(input.buffer).setUint32(this.seed.length, this.counter++, true);
      this.block = sha256(input);
      this.off = 0;
    }
    const v = new DataView(this.block.buffer, this.block.byteOffset).getUint32(this.off, true);
    this.off += 4;
    return v;
  }
  // Uniform integer in [0, n).
  below(n: number): number {
    const limit = Math.floor(0x100000000 / n) * n;
    for (;;) {
      const x = this.u32();
      if (x < limit) return x % n;
    }
  }
}

// Assigns traits to every Strike. Errors go only to Strikes 0..eligible-1 (fully sold when the
// seed block was produced), in a Fisher–Yates order drawn from the seed: the first `count` drawn
// get the first error, the next get the second, and so on. At most one error per Strike.
export function deriveTraits(rules: Rules, blockhash: string, eligible: number): StrikeTraits[] {
  const n = Math.max(0, Math.min(eligible, rules.strikeCount));
  const order = Array.from({ length: n }, (_, i) => i);
  const rng = new Stream(seedFrom(blockhash));
  for (let i = n - 1; i > 0; i--) {
    const j = rng.below(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const errorOf = new Map<number, ErrorTrait>();
  let k = 0;
  for (const e of rules.errors) {
    for (let c = 0; c < e.count && k < order.length; c++) errorOf.set(order[k++], e);
  }
  return Array.from({ length: rules.strikeCount }, (_, strike) => {
    const date = rules.dates.find((d) => strike >= d.from && strike <= d.to) ?? rules.defaultDate;
    const err = errorOf.get(strike);
    return {
      strike,
      rank: date.points + (err?.points ?? 0),
      traits: err ? [date.name, err.name] : [date.name],
    };
  });
}

// ---- SHA-256 (FIPS 180-4), small and synchronous ----

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const bitLen = data.length * 8;
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  h.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
