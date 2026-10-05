// Display helpers. Positions and amounts are base units (6 decimals) as decimal strings.
export const BASE = 1_000_000n;

export function tokens(base: string | bigint): bigint {
  return BigInt(base) / BASE;
}

const nf = new Intl.NumberFormat('en-US');
export function fmtTokens(base: string | bigint): string {
  const b = BigInt(base);
  const whole = b / BASE;
  const frac = b % BASE;
  return frac === 0n ? nf.format(whole) : `${nf.format(whole)}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
}

export function fmtCompact(base: string | bigint): string {
  const n = Number(BigInt(base) / BASE);
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

// Token numbers shown inclusive, e.g. "#1,000,000 – #1,899,989".
export function fmtRange(start: string | bigint, end: string | bigint): string {
  const s = BigInt(start) / BASE;
  const e = (BigInt(end) - 1n) / BASE;
  return s === e ? `#${nf.format(s)}` : `#${nf.format(s)} – #${nf.format(e)}`;
}

export function pct(part: string | bigint, whole: string | bigint): number {
  const w = BigInt(whole);
  if (w === 0n) return 0;
  return Number((BigInt(part) * 10000n) / w) / 100;
}

export function short(addr: string | null | undefined, n = 4): string {
  if (!addr) return '—';
  return addr.length <= n * 2 + 1 ? addr : `${addr.slice(0, n)}…${addr.slice(-n)}`;
}

export function sol(lamports: string | bigint): string {
  const l = BigInt(lamports);
  const whole = l / 1_000_000_000n;
  const frac = (l % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function lamportsFromSol(input: string): bigint {
  const m = /^\s*(\d+)(?:\.(\d{0,9}))?\s*$/.exec(input);
  if (!m) throw new Error('Enter an amount like 0.5');
  return BigInt(m[1]) * 1_000_000_000n + BigInt((m[2] ?? '').padEnd(9, '0'));
}

// Display tier from rank (date points + error points, rules/sequents-v1): 0 common, 1–29 uncommon
// (Final Strike, Key Date, Die Crack), 30–69 rare (Clipped Planchet, Genesis, Off-Center),
// 70+ legendary (Wrong Planchet, Double Die, and strong stacks).
export function tier(rank: number): 0 | 1 | 2 | 3 {
  return rank <= 0 ? 0 : rank < 30 ? 1 : rank < 70 ? 2 : 3;
}
export const TIER_NAMES = ['Common', 'Uncommon', 'Rare', 'Legendary'] as const;

export const CLUSTER = import.meta.env.VITE_CLUSTER ?? 'devnet';
export function explorer(kind: 'tx' | 'address', id: string): string {
  const q = CLUSTER === 'mainnet-beta' ? '' : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/${kind}/${id}${q}`;
}
