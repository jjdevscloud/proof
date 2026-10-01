import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chain, CURVE, STRIKE, T, ledgerBalance, newLedger, r } from './helpers.ts';
import { Ledger, LedgerError } from '../src/ledger.ts';
import { leafHash, merkleRoot } from '../src/reveal.ts';
import type { RevealData } from '../src/reveal.ts';

function revealWith(ranks: Record<number, number>): RevealData {
  return {
    version: 1,
    strikes: Array.from({ length: 794 }, (_, i) => ({
      strike: i, rank: ranks[i] ?? 0, traits: ranks[i] ? ['Double Die'] : ['Common Date'], salt: i.toString(16).padStart(64, '0'),
    })),
  };
}

function revealed(c: Chain, ranks: Record<number, number>) {
  const data = revealWith(ranks);
  const root = merkleRoot(data.strikes.map(leafHash)).toString('hex');
  c.ledger.registerReveal(data, 'f'.repeat(64));
  return { data, root };
}

test('curve buys issue fresh positions in order', () => {
  const c = new Chain();
  const ch = c.tx([{ kind: 'curveBuy', to: 'A', amount: 1_500_000n * T }]);
  assert.deepEqual(ch.changes, [{ kind: 'issue', account: 'A', ranges: [r(0n, 1_500_000n * T)] }]);
  c.tx([{ kind: 'curveBuy', to: 'B', amount: 10n }]);
  assert.deepEqual(c.ledger.holdings.get('B')!.ranges, [r(1_500_000n * T, 1_500_000n * T + 10n)]);
  assert.equal(c.ledger.curve.cursor, 1_500_000n * T + 10n);
});

test('sell-back melts and the position is never reissued (SPEC §3.3)', () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 100n }]);
  const ch = c.tx([{ kind: 'transfer', from: 'A', to: CURVE, amount: 40n }]);
  assert.deepEqual(ch.changes, [{ kind: 'melt', account: 'A', ranges: [r(60n, 100n)], reason: 'sellBack' }]);
  assert.equal(c.ledger.curve.returned, 40n);
  // Next buyer gets the 40 returned tokens as common, then fresh positions from 100.
  c.tx([{ kind: 'curveBuy', to: 'B', amount: 50n }]);
  const b = c.ledger.holdings.get('B')!;
  assert.equal(b.melted, 40n);
  assert.deepEqual(b.ranges, [r(100n, 110n)]);
  assert.equal(c.ledger.curve.returned, 0n);
});

test('non-buy outflow from the curve (migration) is common', () => {
  const c = new Chain();
  c.tx([{ kind: 'transfer', from: CURVE, to: 'POOL', amount: 206_900_000n * T }]);
  assert.equal(c.ledger.holdings.has('POOL'), false); // no ranges -> not tracked
  assert.equal(c.ledger.curve.cursor, 0n);
});

test('outflow before reveal: common first, then highest positions', () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 2n * STRIKE }]);
  // A receives 5 common tokens from elsewhere.
  c.balances.set('X', 5n);
  c.tx([{ kind: 'transfer', from: 'X', to: 'A', amount: 5n }]);
  const ch = c.tx([{ kind: 'transfer', from: 'A', to: 'POOL', amount: 8n }]);
  assert.deepEqual(ch.changes, [{ kind: 'melt', account: 'A', ranges: [r(2n * STRIKE - 3n, 2n * STRIKE)], reason: 'transfer' }]);
  assert.equal(c.ledger.holdings.get('A')!.melted, 0n);
});

test('outflow after reveal: least rare strike first, rare strike protected', () => {
  const c = new Chain();
  const { root } = revealed(c, { 0: 5 });
  c.tx([{ kind: 'commit', root }]);
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 2n * STRIKE }]); // strikes 0 and 1
  c.tx([{ kind: 'reveal', fileHash: 'f'.repeat(64) }]);
  const ch = c.tx([{ kind: 'transfer', from: 'A', to: 'POOL', amount: STRIKE + 1n }]);
  // All of strike 1 (rank 0) leaves first, then the top position of strike 0.
  assert.deepEqual(ch.changes, [{ kind: 'melt', account: 'A', ranges: [r(STRIKE - 1n, 2n * STRIKE)], reason: 'transfer' }]);
  assert.deepEqual(c.ledger.holdings.get('A')!.ranges, [r(0n, STRIKE - 1n)]);
});

test('commit after launch is ignored; reveal without commit is ignored', () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 1n }]);
  c.tx([{ kind: 'commit', root: 'a'.repeat(64) }]);
  assert.equal(c.ledger.commitRoot, null);
  c.tx([{ kind: 'reveal', fileHash: 'f'.repeat(64) }]);
  assert.equal(c.ledger.reveal, null);
});

test('reveal halts when the file is missing or does not match the commit', () => {
  const c = new Chain();
  c.tx([{ kind: 'commit', root: 'a'.repeat(64) }]);
  assert.throws(() => c.tx([{ kind: 'reveal', fileHash: 'f'.repeat(64) }]), /not registered/);
  const c2 = new Chain();
  revealed(c2, {});
  c2.tx([{ kind: 'commit', root: 'a'.repeat(64) }]);
  assert.throws(() => c2.tx([{ kind: 'reveal', fileHash: 'f'.repeat(64) }]), /does not match commit/);
});

test('valid seal moves named ranges intact; sale and gift move the holder, not the tokens', () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 100n }]);
  const seal = c.tx([{ kind: 'seal', from: 'A', holder: 'alice', envelope: 'E1', vault: 'V1', ranges: [r(10n, 20n)], amount: 10n }]);
  assert.deepEqual(seal.changes, [{ kind: 'seal', from: 'A', envelope: 'E1', ranges: [r(10n, 20n)], valid: true }]);
  assert.deepEqual(c.ledger.holdings.get('A')!.ranges, [r(0n, 10n), r(20n, 100n)]);
  c.tx([{ kind: 'list', envelope: 'E1', price: 400n }]);
  const sale = c.tx([{ kind: 'sale', envelope: 'E1', buyer: 'carol' }]);
  assert.deepEqual(sale.changes, [{ kind: 'sale', envelope: 'E1', from: 'alice', to: 'carol', price: 400n }]);
  assert.equal(c.ledger.wallet('carol').envelopes[0].segments[0].start, 10n);
  c.tx([{ kind: 'gift', envelope: 'E1', to: 'dave' }]);
  assert.equal(c.ledger.envelopes.get('E1')!.holder, 'dave');
  assert.deepEqual(c.ledger.holdings.get('V1')!.ranges, [r(10n, 20n)]);
});

test('invalid seal melts through outflow order and the envelope holds common tokens', () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 100n }]);
  // Names a range A does not hold.
  const ch = c.tx([{ kind: 'seal', from: 'A', holder: 'alice', envelope: 'E1', vault: 'V1', ranges: [r(500n, 510n)], amount: 10n }]);
  assert.deepEqual(ch.changes, [
    { kind: 'melt', account: 'A', ranges: [r(90n, 100n)], reason: 'invalidSeal' },
    { kind: 'seal', from: 'A', envelope: 'E1', ranges: [], valid: false },
  ]);
  assert.equal(c.ledger.holdings.get('V1')!.melted, 10n);
  // Mismatched amount is also invalid.
  const ch2 = c.tx([{ kind: 'seal', from: 'A', holder: 'alice', envelope: 'E2', vault: 'V2', ranges: [r(0n, 10n)], amount: 11n }]);
  assert.equal((ch2.changes.at(-1) as any).valid, false);
});

test('withdraw melts everything including dust', () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 100n }]);
  c.tx([{ kind: 'seal', from: 'A', holder: 'alice', envelope: 'E1', vault: 'V1', ranges: [r(0n, 50n)], amount: 50n }]);
  c.balances.set('X', 3n);
  c.tx([{ kind: 'transfer', from: 'X', to: 'V1', amount: 3n }]); // dust
  const ch = c.tx([{ kind: 'withdraw', envelope: 'E1', to: 'A', amount: 53n }]);
  assert.deepEqual(ch.changes, [
    { kind: 'melt', account: 'V1', ranges: [r(0n, 50n)], reason: 'withdraw' },
    { kind: 'withdraw', envelope: 'E1', to: 'A' },
  ]);
  assert.equal(c.ledger.envelopes.size, 0);
  assert.equal(c.ledger.holdings.get('A')!.melted, 53n);
});

test('owner change of an origin account melts all of it', () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 100n }]);
  const ch = c.tx([{ kind: 'ownerChange', account: 'A', newOwner: 'bob' }]);
  assert.deepEqual(ch.changes, [{ kind: 'melt', account: 'A', ranges: [r(0n, 100n)], reason: 'ownerChange' }]);
  assert.equal(c.ledger.holdings.has('A'), false);
});

test('an observed owner change without a SetAuthority event also melts', () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 100n }]);
  const ch = c.tx([{ kind: 'transfer', from: 'A', to: 'A', amount: 1n }], { ownerAfter: { A: 'mallory' } });
  assert.equal(ch.changes[0].kind, 'melt');
});

test('self-transfer is a no-op; burn melts via outflow order', () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 100n }]);
  assert.deepEqual(c.tx([{ kind: 'transfer', from: 'A', to: 'A', amount: 100n }]).changes, []);
  const ch = c.tx([{ kind: 'burn', from: 'A', amount: 1n }]);
  assert.deepEqual(ch.changes, [{ kind: 'melt', account: 'A', ranges: [r(99n, 100n)], reason: 'burn' }]);
});

test('balance mismatches halt', () => {
  const l = newLedger();
  l.applyTx({ slot: 1, signature: 's1', pre: [], post: [{ account: 'A', owner: 'o', balance: 100n }], events: [{ kind: 'curveBuy', to: 'A', amount: 100n }] });
  assert.throws(
    () => l.applyTx({ slot: 2, signature: 's2', pre: [{ account: 'A', owner: 'o', balance: 99n }], post: [], events: [] }),
    LedgerError,
  );
  assert.throws(
    () => l.applyTx({ slot: 3, signature: 's3', pre: [{ account: 'A', owner: 'o', balance: 100n }], post: [{ account: 'A', owner: 'o', balance: 90n }], events: [] }),
    /post-balance mismatch/,
  );
});

test('rejects out-of-order slots', () => {
  const c = new Chain();
  c.slot = 10;
  c.tx([]);
  assert.throws(() => c.ledger.applyTx({ slot: 9, signature: 'x', pre: [], post: [], events: [] }), /before/);
});

test('untracked accounts are dropped once they hold no ranges', () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 10n }]);
  c.tx([{ kind: 'transfer', from: 'A', to: 'B', amount: 10n }]);
  assert.deepEqual([...c.ledger.holdings.keys()], []);
});

test('preview does not mutate', () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 100n }]);
  const before = c.ledger.fingerprint();
  assert.deepEqual(c.ledger.preview('A', 30n), { fromMelted: 0n, ranges: [r(70n, 100n)] });
  assert.equal(c.ledger.fingerprint(), before);
});

test('strike view reports surviving pieces', () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: STRIKE + 10n }]);
  c.tx([{ kind: 'seal', from: 'A', holder: 'alice', envelope: 'E1', vault: 'V1', ranges: [r(0n, 10n)], amount: 10n }]);
  c.tx([{ kind: 'transfer', from: 'A', to: 'POOL', amount: 20n }]);
  const s0 = c.ledger.strike(0);
  assert.equal(s0.issued, STRIKE);
  assert.equal(s0.surviving, STRIKE - 10n);
  assert.deepEqual(s0.pieces.map((p) => [p.account, p.holder, p.amount]), [
    ['A', 'owner-of-A', STRIKE - 20n],
    ['V1', 'alice', 10n],
  ]);
});

test('snapshot round-trip preserves fingerprint and behaviour', () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 100n }]);
  c.tx([{ kind: 'seal', from: 'A', holder: 'alice', envelope: 'E1', vault: 'V1', ranges: [r(0n, 5n)], amount: 5n }]);
  c.tx([{ kind: 'list', envelope: 'E1', price: 9n }]);
  const json = JSON.parse(JSON.stringify(c.ledger.toJSON()));
  const restored = Ledger.fromJSON(c.ledger.config, json);
  assert.equal(restored.fingerprint(), c.ledger.fingerprint());
  c.ledger = restored;
  c.tx([{ kind: 'sale', envelope: 'E1', buyer: 'bob' }]);
  assert.equal(restored.envelopes.get('E1')!.holder, 'bob');
});

test('same transactions give the same fingerprint', () => {
  const run = () => {
    const c = new Chain();
    c.tx([{ kind: 'curveBuy', to: 'A', amount: 100n }]);
    c.tx([{ kind: 'curveBuy', to: 'B', amount: 50n }]);
    c.tx([{ kind: 'transfer', from: 'B', to: 'A', amount: 20n }]);
    return c.ledger.fingerprint();
  };
  assert.equal(run(), run());
  assert.equal(ledgerBalance(newLedger(), 'none'), 0n);
});
