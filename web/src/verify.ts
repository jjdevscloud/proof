// In-browser check that a strike's revealed traits are in the tree committed before launch (SPEC §4.2).
import type { Proof } from './api.ts';

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));

export async function verifyStrike(p: Proof): Promise<{ ok: boolean; computedRoot: string; leaf: string }> {
  const s = p.strike;
  let h = await sha256(new TextEncoder().encode(`proof:v1|${s.strike}|${s.rank}|${s.traits.join(',')}|${s.salt}`));
  const leaf = hex(h);
  let index = s.strike;
  for (const sibHex of p.proof) {
    const sib = unhex(sibHex);
    const pair = new Uint8Array(64);
    if (index & 1) {
      pair.set(sib, 0);
      pair.set(h, 32);
    } else {
      pair.set(h, 0);
      pair.set(sib, 32);
    }
    h = await sha256(pair);
    index >>= 1;
  }
  return { ok: hex(h) === p.root, computedRoot: hex(h), leaf };
}
