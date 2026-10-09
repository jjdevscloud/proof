import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chain, STRIKE, T } from './helpers.ts';
import { Ledger } from '../src/ledger.ts';
import { parseRules, rollResult } from '../src/derive.ts';
import type { RollRules } from '../src/derive.ts';

const TEMPLATE = readFileSync(new URL('../../rules/sequents-v1.template.json', import.meta.url), 'utf8');
const ROLL: RollRules = parseRules(TEMPLATE.replace('"deadlineSlot": 0', '"deadlineSlot": 1')).roll!;
const TREASURY = ROLL.treasury;
const FEE = BigInt(ROLL.feeLamports);
const BH = '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM';
const ORDINARY = 1n << 62n; // declared start for an ordinary seal: past the saleable supply

function chain(): Chain {
  return new Chain(new Ledger({ curveTokenAccount: 'CURVE', saleableSupply: 793_100_000n * T, strikeSize: STRIKE, roll: ROLL }));
}

// Alice's account A gets `amount` ordinary tokens (bought from someone else), then seals them.
function sealOrdinary(c: Chain, amount: bigint, envelope = 'E1') {
  c.balances.set('X', amount);
  c.tx([{ kind: 'transfer', from: 'X', to: 'A', amount }]);
  return c.tx([{ kind: 'seal', from: 'A', holder: 'alice', envelope, vault: `V-${envelope}`, ranges: [{ start: ORDINARY, end: ORDINARY + amount }], amount }]);
}
const pay = (from = 'alice', lamports = FEE) => ({ kind: 'lamports' as const, from, to: TREASURY, lamports });

test('the template roll rules parse; odds stay within one million', () => {
  assert.equal(ROLL.tiers.length, 10);
  assert.equal(ROLL.fallback.name, 'Coal');
  assert.ok(ROLL.tiers.reduce((t, x) => t + x.odds, 0) <= 1_000_000);
  assert.throws(() => parseRules(TEMPLATE.replace('"deadlineSlot": 0', '"deadlineSlot": 1').replace('"odds": 40000', '"odds": 990000')), /more than 1,000,000/);
});

test('an ordinary seal is marked as such, not as a failed seal', () => {
  const c = chain();
  const ch = sealOrdinary(c, 50_000n * T);
  assert.deepEqual(ch.changes, [{ kind: 'seal', from: 'A', envelope: 'E1', ranges: [], valid: false, ordinary: 50_000n * T }]);
});

test('a paid roll settles at the first block at or after roll slot + delay', () => {
  const c = chain();
  sealOrdinary(c, 50_000n * T);
  const rollSlot = c.slot;
  const ch = c.tx([pay(), { kind: 'roll', envelope: 'E1' }]);
  assert.deepEqual(ch.changes, [{ kind: 'roll', envelope: 'E1', holder: 'alice', valid: true }]);
  const env = c.ledger.envelopes.get('E1')!;
  assert.deepEqual(env.rolling, { signature: ch.signature, slot: rollSlot, seedSlot: rollSlot + ROLL.seedDelaySlots });
  assert.deepEqual(c.ledger.dueRolls(rollSlot + 1), []);
  assert.equal(c.ledger.dueRolls(rollSlot + 2).length, 1);
  assert.throws(() => c.ledger.settleRoll('E1', rollSlot + 1, BH), /before seed slot/);
  const settled = c.ledger.settleRoll('E1', rollSlot + 3, BH);
  const expected = rollResult(ROLL, ch.signature, BH); // what every browser computes
  assert.deepEqual(settled.changes, [{ kind: 'rolled', envelope: 'E1', holder: 'alice', ...expected, seedSlot: rollSlot + 3, blockhash: BH }]);
  assert.deepEqual(env.roll, { ...expected, signature: ch.signature });
  assert.equal(env.rolling, null);
});

test('rolls that break a rule are recorded as invalid and change nothing', () => {
  const reason = (setup: (c: Chain) => void, events: any[]) => {
    const c = chain();
    sealOrdinary(c, 50_000n * T);
    setup(c);
    const ch = c.tx(events);
    assert.equal(c.ledger.envelopes.get('E1')?.rolling ?? null, null);
    return (ch.changes.find((x) => x.kind === 'roll') as any)?.reason;
  };
  const roll = { kind: 'roll', envelope: 'E1' };
  assert.equal(reason(() => {}, [roll]), 'fee not paid by the holder');
  assert.equal(reason(() => {}, [pay('alice', FEE - 1n), roll]), 'fee not paid by the holder');
  assert.equal(reason(() => {}, [pay('mallory'), roll]), 'fee not paid by the holder');
  assert.equal(reason(() => {}, [{ ...pay(), to: 'elsewhere' }, roll]), 'fee not paid by the holder');
  assert.equal(reason((c) => c.tx([{ kind: 'list', envelope: 'E1', price: 5n }]), [pay(), roll]), 'envelope is listed');

  const small = chain();
  sealOrdinary(small, 49_999n * T);
  assert.equal((small.tx([pay(), roll as any]).changes[0] as any).reason, 'envelope holds less than the minimum');

  const rare = chain();
  rare.tx([{ kind: 'curveBuy', to: 'A', amount: 60_000n * T }]);
  rare.tx([{ kind: 'seal', from: 'A', holder: 'alice', envelope: 'E1', vault: 'V1', ranges: [{ start: 0n, end: 60_000n * T }], amount: 60_000n * T }]);
  assert.equal((rare.tx([pay(), roll as any]).changes[0] as any).reason, 'envelope holds rare Strikes');
});

test('one roll per transaction, none while one is pending, Coal may roll again, a rare may not', () => {
  const c = chain();
  sealOrdinary(c, 100_000n * T);
  const first = c.tx([pay('alice', 2n * FEE), { kind: 'roll', envelope: 'E1' }, { kind: 'roll', envelope: 'E1' }]);
  assert.equal(first.changes.length, 1);
  assert.equal((c.tx([pay(), { kind: 'roll', envelope: 'E1' }]).changes[0] as any).reason, 'a roll is already in progress');
  const env = c.ledger.envelopes.get('E1')!;
  env.rolling = null;
  env.roll = { name: 'Coal', points: 0, signature: first.signature };
  assert.equal((c.tx([pay(), { kind: 'roll', envelope: 'E1' }]).changes[0] as any).valid, true);
  env.rolling = null;
  env.roll = { name: 'Assay', points: 10, signature: first.signature };
  assert.equal((c.tx([pay(), { kind: 'roll', envelope: 'E1' }]).changes[0] as any).reason, 'envelope already holds a rare roll');
});

test('seal and roll in one transaction; withdrawing before settlement voids the roll', () => {
  const c = chain();
  c.balances.set('X', 50_000n * T);
  c.tx([{ kind: 'transfer', from: 'X', to: 'A', amount: 50_000n * T }]);
  const ch = c.tx([
    pay(),
    { kind: 'seal', from: 'A', holder: 'alice', envelope: 'E1', vault: 'V1', ranges: [{ start: ORDINARY, end: ORDINARY + 50_000n * T }], amount: 50_000n * T },
    { kind: 'roll', envelope: 'E1' },
  ]);
  assert.deepEqual(ch.changes.map((x) => x.kind), ['seal', 'roll']);
  c.tx([{ kind: 'withdraw', envelope: 'E1', to: 'A', amount: 50_000n * T }]);
  assert.deepEqual(c.ledger.dueRolls(1e9), []);
});

test('a sold envelope keeps its roll; snapshots keep rolls and pending rolls', () => {
  const c = chain();
  sealOrdinary(c, 50_000n * T);
  const r = c.tx([pay(), { kind: 'roll', envelope: 'E1' }]);
  const restored = Ledger.fromJSON(c.ledger.config, JSON.parse(JSON.stringify(c.ledger.toJSON())));
  assert.equal(restored.fingerprint(), c.ledger.fingerprint());
  assert.equal(restored.envelopes.get('E1')!.rolling!.signature, r.signature);
  c.ledger = restored;
  c.ledger.settleRoll('E1', c.slot + 5, BH);
  c.tx([{ kind: 'list', envelope: 'E1', price: 9n }]);
  c.tx([{ kind: 'sale', envelope: 'E1', buyer: 'bob' }]);
  assert.equal(c.ledger.envelopes.get('E1')!.roll!.signature, r.signature);
  // Older snapshots without roll fields load with none.
  const json: any = c.ledger.toJSON();
  delete json.envelopes[0].roll;
  delete json.envelopes[0].rolling;
  assert.equal(Ledger.fromJSON(c.ledger.config, json).envelopes.get('E1')!.roll, null);
});

test('roll results follow the odds', () => {
  const counts = new Map<string, number>();
  const N = 200_000;
  for (let i = 0; i < N; i++) {
    const r = rollResult(ROLL, `sig${i}`, BH);
    counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  }
  for (const t of ROLL.tiers) {
    const expect = (N * t.odds) / 1e6;
    assert.ok(Math.abs((counts.get(t.name) ?? 0) - expect) < 5 * Math.sqrt(expect) + 3, `${t.name}: ${counts.get(t.name)} vs ${expect}`);
  }
  assert.ok(counts.get('Coal')! > N * 0.85);
});
