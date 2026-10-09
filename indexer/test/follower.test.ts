import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Follower } from '../src/follower.ts';
import type { DecodedTx } from '../src/ledger.ts';
import { CURVE, newLedger } from './helpers.ts';

type FakeTx = DecodedTx & { touches: string[] };

// Fake chain: signatures per address and block order come from the tx list.
function fakeRpc(txs: FakeTx[], finalized: number) {
  const queried: string[] = [];
  let tip = finalized;
  return {
    queried,
    setTip: (n: number) => void (tip = n),
    finalizedSlot: async () => tip,
    // Chain state now: each account's last post observation.
    multipleTokenAccounts: async (addresses: string[]) => addresses.map((a) => {
      const last = txs.filter((t) => t.slot <= tip).flatMap((t) => t.post).filter((o) => o.account === a).pop();
      return last ? { amount: last.balance, owner: last.owner } : null;
    }),
    signatures: async (address: string, from: number, to: number) => (queried.push(address),
      txs.filter((t) => t.touches.includes(address) && t.slot >= from && t.slot <= to)
        .reverse().map((t) => ({ signature: t.signature, slot: t.slot, err: null }))),
    transaction: async (sig: string) => txs.find((t) => t.signature === sig),
    blockOrder: async (slot: number) => txs.filter((t) => t.slot === slot).map((t) => t.signature),
  };
}
const passthrough = { decode: (raw: any) => raw };
const cfg = { curveTokenAccount: CURVE, vaultProgramId: 'VAULT', revealAuthority: 'AUTH', maxWindowSlots: 1000 };
const obs = (account: string, balance: bigint) => ({ account, owner: 'o-' + account, balance });

test('picks up a newly ranged account mid-window and keeps its order', async () => {
  const txs: FakeTx[] = [
    // Same slot: B spends its old common tokens, *then* buys from the curve.
    { slot: 10, signature: 'b-old', touches: ['B'], pre: [obs('B', 5n)], post: [obs('B', 0n)],
      events: [{ kind: 'transfer', from: 'B', to: 'X', amount: 5n }] },
    { slot: 10, signature: 'buy', touches: [CURVE, 'B'], pre: [obs('B', 0n)], post: [obs('B', 100n)],
      events: [{ kind: 'curveBuy', to: 'B', amount: 100n }] },
    // Touches only B: not visible until B is watched.
    { slot: 12, signature: 'b-sell', touches: ['B'], pre: [obs('B', 100n)], post: [obs('B', 70n)],
      events: [{ kind: 'transfer', from: 'B', to: 'POOL', amount: 30n }] },
    { slot: 14, signature: 'sellback', touches: ['B', CURVE], pre: [obs('B', 70n)], post: [obs('B', 60n)],
      events: [{ kind: 'transfer', from: 'B', to: CURVE, amount: 10n }] },
  ];
  const ledger = newLedger();
  const f = new Follower(ledger, passthrough as any, fakeRpc(txs, 20) as any, cfg, 0);
  const applied: string[] = [];
  const n = await f.syncOnce((c) => applied.push(c.signature));
  // b-old predates B's ranges; applying it is harmless (B is untracked until the buy).
  assert.deepEqual(applied, ['b-old', 'buy', 'b-sell', 'sellback']);
  assert.equal(n, 4);
  assert.deepEqual(ledger.holdings.get('B')!.ranges, [{ start: 0n, end: 60n }]);
  assert.equal(ledger.curve.returned, 10n);
  assert.equal(f.syncedSlot, 20);
});

test('respects the window size', async () => {
  const txs: FakeTx[] = [
    { slot: 5, signature: 'a', touches: [CURVE, 'A'], pre: [], post: [obs('A', 1n)], events: [{ kind: 'curveBuy', to: 'A', amount: 1n }] },
    { slot: 50, signature: 'b', touches: [CURVE, 'A'], pre: [obs('A', 1n)], post: [obs('A', 2n)], events: [{ kind: 'curveBuy', to: 'A', amount: 1n }] },
  ];
  const f = new Follower(newLedger(), passthrough as any, fakeRpc(txs, 100) as any, { ...cfg, maxWindowSlots: 10 }, 0);
  assert.equal(await f.syncOnce(() => {}), 1);
  assert.equal(f.syncedSlot, 10);
});

test('a pending roll settles with the first block at or after its seed slot, before later transactions', async () => {
  const { Ledger } = await import('../src/ledger.ts');
  const { parseRules, rollResult } = await import('../src/derive.ts');
  const { readFileSync } = await import('node:fs');
  const T = 1_000_000n;
  const roll = parseRules(readFileSync(new URL('../../rules/sequents-v1.template.json', import.meta.url), 'utf8').replace('"deadlineSlot": 0', '"deadlineSlot": 1')).roll!;
  const ledger = new Ledger({ curveTokenAccount: CURVE, saleableSupply: 793_100_000n * T, strikeSize: 1_000_000n * T, roll });
  const amount = 50_000n * T;
  const big = 1n << 62n;
  const txs: FakeTx[] = [
    { slot: 10, signature: 'seal-roll', touches: [roll.treasury, 'VAULT'], pre: [obs('A', amount)], post: [obs('A', 0n), { account: 'V1', owner: 'E1', balance: amount }],
      events: [
        { kind: 'lamports', from: 'alice', to: roll.treasury, lamports: BigInt(roll.feeLamports) },
        { kind: 'seal', from: 'A', holder: 'alice', envelope: 'E1', vault: 'V1', ranges: [{ start: big, end: big + amount }], amount },
        { kind: 'roll', envelope: 'E1' },
      ] },
    // Slots 11 and 12 skipped: the seed block (first at or after 12) is 13, so the roll settles
    // before this listing is applied.
    { slot: 13, signature: 'list', touches: ['VAULT'], pre: [], post: [], events: [{ kind: 'list', envelope: 'E1', price: 5n }] },
  ];
  const rpc = { ...fakeRpc(txs, 20), firstBlockFrom: async (slot: number) => (slot <= 13 ? { slot: 13, blockhash: 'HASH13' } : { slot, blockhash: `HASH${slot}` }) };
  const f = new Follower(ledger, passthrough as any, rpc as any, { ...cfg, rollTreasury: roll.treasury }, 0);
  const seen: string[] = [];
  await f.syncOnce((c) => seen.push(`${c.signature}:${c.changes.map((x) => x.kind).join(',')}`));
  assert.deepEqual(seen, ['seal-roll:seal,roll', 'seal-roll:rolled', 'list:list']);
  assert.deepEqual(ledger.envelopes.get('E1')!.roll, { ...rollResult(roll, 'seal-roll', 'HASH13'), signature: 'seal-roll' });
});


test('holders are not queried one by one; one that moved without the mint is found by its balance', async () => {
  const txs: FakeTx[] = [
    { slot: 5, signature: 'buy-a', touches: [CURVE, 'A'], pre: [], post: [obs('A', 100n)], events: [{ kind: 'curveBuy', to: 'A', amount: 100n }] },
    { slot: 6, signature: 'buy-b', touches: [CURVE, 'B'], pre: [], post: [obs('B', 100n)], events: [{ kind: 'curveBuy', to: 'B', amount: 100n }] },
  ];
  const ledger = newLedger();
  const rpc = fakeRpc(txs, 10);
  const f = new Follower(ledger, passthrough as any, rpc as any, cfg, 0);
  await f.syncOnce(() => {});
  // Next window: A sends 40 with a plain transfer (touches only A and X, not the mint or the curve).
  txs.push({ slot: 15, signature: 'a-plain', touches: ['A'], pre: [obs('A', 100n)], post: [obs('A', 60n)], events: [{ kind: 'transfer', from: 'A', to: 'X', amount: 40n }] });
  rpc.queried.length = 0;
  rpc.setTip(20);
  const applied: string[] = [];
  await f.syncOnce((c) => applied.push(c.signature));
  assert.deepEqual(applied, ['a-plain']);
  assert.deepEqual(ledger.holdings.get('A')!.ranges, [{ start: 0n, end: 60n }]);
  assert.ok(rpc.queried.includes('A'), 'A changed, so its history was fetched');
  assert.ok(!rpc.queried.includes('B'), 'B did not change, so it was not queried');
});

test('watches the mint: a transfer naming the mint is applied without any holder query', async () => {
  const txs: FakeTx[] = [
    { slot: 5, signature: 'buy-a', touches: [CURVE, 'A'], pre: [], post: [obs('A', 100n)], events: [{ kind: 'curveBuy', to: 'A', amount: 100n }] },
    { slot: 6, signature: 'a-swap', touches: ['A', 'MINT'], pre: [obs('A', 100n)], post: [obs('A', 70n)], events: [{ kind: 'transfer', from: 'A', to: 'POOL', amount: 30n }] },
  ];
  const ledger = newLedger();
  const rpc = fakeRpc(txs, 10);
  const f = new Follower(ledger, passthrough as any, rpc as any, { ...cfg, mint: 'MINT' }, 0);
  const applied: string[] = [];
  await f.syncOnce((c) => applied.push(c.signature));
  assert.deepEqual(applied, ['buy-a', 'a-swap']);
  assert.deepEqual(ledger.holdings.get('A')!.ranges, [{ start: 0n, end: 70n }]);
});
