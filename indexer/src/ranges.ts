// Half-open ranges of curve positions, in base units: [start, end).

export type Range = { start: bigint; end: bigint };
export type Segment = Range & { strike: number };

export class RangeError extends Error {}

export function len(r: Range): bigint {
  return r.end - r.start;
}

export function total(rs: readonly Range[]): bigint {
  let t = 0n;
  for (const r of rs) t += len(r);
  return t;
}

// Sorts and merges touching ranges. Throws on empty or overlapping ranges.
export function normalize(rs: readonly Range[]): Range[] {
  const sorted = rs.map((r) => ({ start: r.start, end: r.end })).sort(cmpStart);
  const out: Range[] = [];
  for (const r of sorted) {
    if (r.end <= r.start) throw new RangeError(`empty range ${r.start}-${r.end}`);
    const last = out[out.length - 1];
    if (last && r.start < last.end) throw new RangeError(`overlapping ranges at ${r.start}`);
    if (last && r.start === last.end) last.end = r.end;
    else out.push(r);
  }
  return out;
}

export function add(rs: readonly Range[], more: readonly Range[]): Range[] {
  return normalize([...rs, ...more]);
}

export function contains(rs: readonly Range[], r: Range): boolean {
  return rs.some((x) => x.start <= r.start && r.end <= x.end);
}

// Removes `cut` from `rs`. Every cut range must be fully held.
export function subtract(rs: readonly Range[], cut: readonly Range[]): Range[] {
  let out = normalize(rs);
  for (const c of normalize(cut)) {
    const i = out.findIndex((x) => x.start <= c.start && c.end <= x.end);
    if (i < 0) throw new RangeError(`range ${c.start}-${c.end} not held`);
    const x = out[i];
    const pieces: Range[] = [];
    if (x.start < c.start) pieces.push({ start: x.start, end: c.start });
    if (c.end < x.end) pieces.push({ start: c.end, end: x.end });
    out = [...out.slice(0, i), ...pieces, ...out.slice(i + 1)];
  }
  return out;
}

export function strikeOf(position: bigint, strikeSize: bigint): number {
  return Number(position / strikeSize);
}

// Splits ranges at strike boundaries so each segment belongs to exactly one strike.
export function splitByStrike(rs: readonly Range[], strikeSize: bigint): Segment[] {
  const out: Segment[] = [];
  for (const r of rs) {
    let s = r.start;
    while (s < r.end) {
      const strike = strikeOf(s, strikeSize);
      const boundary = BigInt(strike + 1) * strikeSize;
      const e = boundary < r.end ? boundary : r.end;
      out.push({ start: s, end: e, strike });
      s = e;
    }
  }
  return out;
}

function cmpStart(a: Range, b: Range): number {
  return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
}
