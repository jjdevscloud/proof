import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leafHash, merkleProof, merkleRoot, parseReveal, verifyProof } from '../src/reveal.ts';

const strikes = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ strike: i, rank: i % 3, traits: ['T' + i], salt: (i + 1).toString(16).padStart(64, '0') }));

test('every leaf verifies against the root, including odd levels', () => {
  for (const n of [1, 2, 3, 5, 794]) {
    const leaves = strikes(n).map(leafHash);
    const root = merkleRoot(leaves).toString('hex');
    for (let i = 0; i < n; i++) assert.ok(verifyProof(leaves[i], i, merkleProof(leaves, i), root), `n=${n} i=${i}`);
  }
});

test('a tampered leaf fails', () => {
  const s = strikes(5);
  const leaves = s.map(leafHash);
  const root = merkleRoot(leaves).toString('hex');
  const forged = leafHash({ ...s[2], rank: 99 });
  assert.equal(verifyProof(forged, 2, merkleProof(leaves, 2), root), false);
});

test('parseReveal validates structure', () => {
  const ok = Buffer.from(JSON.stringify({ version: 1, strikes: strikes(4) }));
  const { fileHash, root } = parseReveal(ok, 4);
  assert.match(fileHash, /^[0-9a-f]{64}$/);
  assert.equal(root, merkleRoot(strikes(4).map(leafHash)).toString('hex'));
  assert.throws(() => parseReveal(ok, 5), /expected 5/);
  const dupSalt = strikes(2).map((s) => ({ ...s, salt: 'a'.repeat(64) }));
  assert.throws(() => parseReveal(Buffer.from(JSON.stringify({ version: 1, strikes: dupSalt })), 2), /duplicate salt/);
  const badTrait = strikes(1).map((s) => ({ ...s, traits: ['a|b'] }));
  assert.throws(() => parseReveal(Buffer.from(JSON.stringify({ version: 1, strikes: badTrait })), 1), /bad trait/);
});
