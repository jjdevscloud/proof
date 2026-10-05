// DEMO MODE (VITE_DEMO=1): realistic fake data for every page, so the site can be designed and
// reviewed without an indexer, a wallet or a token. Never used in the real build.
import { PublicKey } from '@solana/web3.js';
import { deriveTraits, parseRules } from '../../indexer/src/derive.ts';
import rulesTemplate from '../../rules/sequents-v1.template.json';
import type {
  Config, Envelope, Health, Preview, RangeJson, RevealStatus, Segment, Stats, StrikeDetail, StrikeRow, TxChanges, WalletView,
} from './api.ts';

export const DEMO = import.meta.env.VITE_DEMO === '1';
// Valid-looking, deterministic demo addresses.
const pk = (i: number) => new PublicKey(Uint8Array.from({ length: 32 }, (_, k) => (i * 131 + k * 29 + ((i * k) % 251)) & 0xff)).toBase58();
export const DEMO_WALLET = pk(42_424);

const T = 1_000_000n;
const STRIKE = 1_000_000n * T;
const BLOCKHASH = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const rulesText = JSON.stringify({ ...rulesTemplate, deadlineSlot: 455_000_000 }, null, 2);
const rules = parseRules(rulesText);
const traits = deriveTraits(rules, BLOCKHASH, 640);
const SOLD_STRIKES = 640; // the curve sold 640 of 794 Strikes in this demo

// Deterministic pseudo-random numbers so the demo looks the same on every load.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(7);
const addr = pk;

const strikeRange = (n: number, fromFrac = 0, toFrac = 1): RangeJson => ({
  start: (BigInt(n) * STRIKE + (STRIKE * BigInt(Math.round(fromFrac * 1000))) / 1000n).toString(),
  end: (BigInt(n) * STRIKE + (STRIKE * BigInt(Math.round(toFrac * 1000))) / 1000n).toString(),
});
const seg = (n: number, fromFrac = 0, toFrac = 1): Segment => ({ ...strikeRange(n, fromFrac, toFrac), strike: n, rank: traits[n].rank, traits: traits[n].traits });

// Surviving share per Strike: early and rare Strikes survive better (holders keep them).
const surviving = traits.map((t, n) => {
  if (n >= SOLD_STRIKES) return 0;
  const base = t.rank > 0 ? 0.55 + rand() * 0.45 : rand() < 0.35 ? 0 : rand() * 0.8;
  return Math.round(base * 1000) / 1000;
});

const strikes: StrikeRow[] = traits.map((t, n) => ({
  strike: n,
  rank: t.rank,
  traits: t.traits,
  issued: n < SOLD_STRIKES ? (n === 793 ? (100_000n * T).toString() : STRIKE.toString()) : '0',
  surviving: ((STRIKE * BigInt(Math.round(surviving[n] * 1000))) / 1000n).toString(),
}));

const rare = traits.filter((t) => t.traits.length > 1 && t.strike < SOLD_STRIKES).map((t) => t.strike);
const price = (n: number) => (BigInt(Math.round((0.2 + traits[n].rank / 25 + rand()) * 100)) * 10_000_000n).toString(); // 2 decimals

const envelopes: Envelope[] = rare.slice(0, 9).map((n, i) => ({
  address: addr(100 + i),
  vault: addr(200 + i),
  holder: i === 1 ? DEMO_WALLET : addr(300 + i),
  status: i % 3 === 2 ? 'sealed' : 'listed',
  price: i % 3 === 2 ? '0' : price(n),
  sealedSlot: 453_500_000 + i * 977,
  ranges: [strikeRange(n)],
  common: '0',
  segments: [seg(n)],
}));
envelopes.push({
  address: addr(150), vault: addr(250), holder: DEMO_WALLET, status: 'sealed', price: '0', sealedSlot: 453_600_000,
  ranges: [], common: (10n * T).toString(), segments: [],
});

const wallet: WalletView = {
  accounts: [
    { account: addr(400), common: (250_000n * T).toString(), segments: [seg(3), seg(17, 0, 0.6), seg(rare[3])] },
    { account: addr(401), common: '0', segments: [seg(212, 0.2, 1)] },
  ],
  envelopes: envelopes.filter((e) => e.holder === DEMO_WALLET),
};

const sum = (xs: string[]) => xs.reduce((t, x) => t + BigInt(x), 0n);
const stats: Stats = (() => {
  const issued = sum(strikes.map((s) => s.issued));
  const surv = sum(strikes.map((s) => s.surviving));
  const byRank = new Map<number, { rank: number; issued: bigint; surviving: bigint; strikes: number }>();
  for (const s of strikes) {
    const r = byRank.get(s.rank) ?? { rank: s.rank, issued: 0n, surviving: 0n, strikes: 0 };
    r.issued += BigInt(s.issued);
    r.surviving += BigInt(s.surviving);
    r.strikes++;
    byRank.set(s.rank, r);
  }
  return {
    issued: issued.toString(), saleable: (793_100_000n * T).toString(), surviving: surv.toString(), melted: (issued - surv).toString(),
    sealed: (BigInt(envelopes.length) * STRIKE).toString(), envelopes: envelopes.length, listed: envelopes.filter((e) => e.status === 'listed').length,
    byRank: [...byRank.values()].sort((a, b) => b.rank - a.rank).map((r) => ({ ...r, issued: r.issued.toString(), surviving: r.surviving.toString() })),
    revealed: true, lastSlot: 453_700_000,
  };
})();

const activity: TxChanges[] = Array.from({ length: 40 }, (_, i) => {
  const n = rare[i % rare.length];
  const slot = 453_700_000 - i * 413;
  const signature = addr(900 + i) + addr(950 + i).slice(0, 44);
  const kinds: TxChanges['changes'] = [
    [{ kind: 'issue', account: addr(500 + i), ranges: [strikeRange(SOLD_STRIKES - 1 - i)] }],
    [{ kind: 'melt', account: addr(600 + i), ranges: [strikeRange(40 + i, 0.5, 1)], reason: 'transfer' }],
    [{ kind: 'seal', from: addr(700 + i), envelope: addr(100 + (i % 9)), ranges: [strikeRange(n)], valid: true }],
    [{ kind: 'list', envelope: addr(100 + (i % 9)), price: price(n) }],
    [{ kind: 'sale', envelope: addr(100 + (i % 9)), from: addr(300 + i), to: addr(800 + i), price: price(n) }],
    [{ kind: 'melt', account: addr(650 + i), ranges: [strikeRange(n)], reason: 'withdraw' }],
  ][i % 6] as TxChanges['changes'];
  return { slot, signature, changes: kinds };
});
activity.push({ slot: 453_400_000, signature: addr(990), changes: [{ kind: 'reveal', fileHash: 'ab'.repeat(32) }] });
activity.push({ slot: 453_000_000, signature: addr(991), changes: [{ kind: 'commit', root: 'cd'.repeat(32), deadlineSlot: 455_000_000 }] });

const config: Config = {
  mint: addr(1), vaultProgramId: addr(2), curveTokenAccount: addr(3), curveProgramId: addr(4), revealAuthority: addr(5),
  strikeCount: 794, strikeSize: STRIKE.toString(), saleableSupply: (793_100_000n * T).toString(),
  commitRoot: 'demo', revealHash: 'ab'.repeat(32), revealed: true, pending: false,
};

const reveal: RevealStatus = {
  commitRoot: 'demo', deadlineSlot: 455_000_000, completionSlot: null, seedTargetSlot: 455_000_000, seedFixed: true,
  eligibleStrikes: SOLD_STRIKES, revealed: true, revealHash: 'ab'.repeat(32), rules: rulesText, seedSlot: 455_000_001, blockhash: BLOCKHASH,
};

function strikeDetail(n: number): StrikeDetail {
  const s = strikes[n];
  const pieces = BigInt(s.surviving) > 0n
    ? [
        { account: addr(1000 + n), envelope: null, holder: addr(1100 + n), amount: ((BigInt(s.surviving) * 6n) / 10n).toString() },
        { account: addr(1200 + n), envelope: addr(1300 + n), holder: addr(1400 + n), amount: ((BigInt(s.surviving) * 4n) / 10n).toString() },
      ]
    : [];
  return {
    strike: n, size: n === 793 ? (100_000n * T).toString() : STRIKE.toString(), issued: s.issued, surviving: s.surviving, rank: s.rank, traits: s.traits,
    pieces, history: activity.filter((a) => a.changes.some((c) => 'ranges' in c && c.ranges.some((r) => BigInt(r.start) / STRIKE === BigInt(n)))),
  };
}

// Answers the same paths as the real API (see api.ts).
export function demoApi(path: string): unknown {
  const url = new URL(path, 'http://demo');
  const [route, arg] = url.pathname.split('/').filter(Boolean);
  switch (route) {
    case 'config': return config;
    case 'health': return { syncedSlot: 453_700_120, lastSlot: 453_700_000, fingerprint: 'demo'.repeat(16), revealed: true } satisfies Health;
    case 'stats': return stats;
    case 'strikes': return strikes;
    case 'strike': return strikeDetail(Number(arg));
    case 'envelopes': {
      const status = url.searchParams.get('status');
      return envelopes.filter((e) => !status || e.status === status);
    }
    case 'envelope': return envelopes.find((e) => e.address === arg) ?? null;
    case 'wallet': return wallet;
    case 'activity': return activity.slice(0, Number(url.searchParams.get('limit') ?? 50));
    case 'reveal': return reveal;
    case 'rules': return { final: true, rules: JSON.parse(rulesText) };
    case 'preview': {
      const amount = BigInt(url.searchParams.get('amount') ?? '0');
      const common = 250_000n * T;
      const fromMelted = amount < common ? amount : common;
      const rest = amount - fromMelted;
      const segments: Segment[] = rest > 0n ? [{ ...seg(17), start: (17n * STRIKE + STRIKE * 6n / 10n - rest).toString(), end: (17n * STRIKE + STRIKE * 6n / 10n).toString() }] : [];
      return { fromMelted: fromMelted.toString(), ranges: segments.map(({ start, end }) => ({ start, end })), segments } satisfies Preview;
    }
    default: throw new Error(`demo: no data for ${path}`);
  }
}

export const demoTraits = traits;
