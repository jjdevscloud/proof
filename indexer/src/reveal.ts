// Commit/reveal of strike traits (SPEC §4).
import { createHash } from 'node:crypto';

export type RevealStrike = { strike: number; rank: number; traits: string[]; salt: string };
export type RevealData = { version: 1; strikes: RevealStrike[] };

export class RevealError extends Error {}

export function sha256(data: Uint8Array | string): Buffer {
  return createHash('sha256').update(data).digest();
}

export function leafHash(s: RevealStrike): Buffer {
  return sha256(`proof:v1|${s.strike}|${s.rank}|${s.traits.join(',')}|${s.salt}`);
}

// Parent = sha256(left || right); an odd node is paired with itself.
export function merkleLevels(leaves: readonly Buffer[]): Buffer[][] {
  if (leaves.length === 0) throw new RevealError('no leaves');
  const levels: Buffer[][] = [[...leaves]];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: Buffer[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(sha256(Buffer.concat([prev[i], prev[i + 1] ?? prev[i]])));
    }
    levels.push(next);
  }
  return levels;
}

export function merkleRoot(leaves: readonly Buffer[]): Buffer {
  const levels = merkleLevels(leaves);
  return levels[levels.length - 1][0];
}

export function merkleProof(leaves: readonly Buffer[], index: number): Buffer[] {
  const proof: Buffer[] = [];
  for (const level of merkleLevels(leaves).slice(0, -1)) {
    const sibling = index ^ 1;
    proof.push(level[sibling] ?? level[index]);
    index >>= 1;
  }
  return proof;
}

export function verifyProof(leaf: Buffer, index: number, proof: readonly Buffer[], rootHex: string): boolean {
  let h = leaf;
  for (const sib of proof) {
    h = index & 1 ? sha256(Buffer.concat([sib, h])) : sha256(Buffer.concat([h, sib]));
    index >>= 1;
  }
  return h.toString('hex') === rootHex;
}

// Validates a reveal file's structure. Returns the parsed data, its file hash and root.
export function parseReveal(bytes: Uint8Array, strikeCount: number): { data: RevealData; fileHash: string; root: string } {
  let data: RevealData;
  try {
    data = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new RevealError('reveal file is not valid JSON');
  }
  if (data.version !== 1 || !Array.isArray(data.strikes)) throw new RevealError('unsupported reveal file');
  if (data.strikes.length !== strikeCount) {
    throw new RevealError(`expected ${strikeCount} strikes, got ${data.strikes.length}`);
  }
  const salts = new Set<string>();
  data.strikes.forEach((s, i) => {
    if (s.strike !== i) throw new RevealError(`strike ${i} missing or out of order`);
    if (!Number.isSafeInteger(s.rank) || s.rank < 0) throw new RevealError(`strike ${i}: bad rank`);
    if (!/^[0-9a-f]{64}$/.test(s.salt)) throw new RevealError(`strike ${i}: salt must be 32 bytes hex`);
    if (salts.has(s.salt)) throw new RevealError(`strike ${i}: duplicate salt`);
    salts.add(s.salt);
    for (const t of s.traits) {
      if (!t || t.includes('|') || t.includes(',')) throw new RevealError(`strike ${i}: bad trait "${t}"`);
    }
  });
  return {
    data,
    fileHash: sha256(bytes).toString('hex'),
    root: merkleRoot(data.strikes.map(leafHash)).toString('hex'),
  };
}
