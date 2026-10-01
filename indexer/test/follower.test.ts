import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Follower } from '../src/follower.ts';
import type { DecodedTx } from '../src/ledger.ts';
import { CURVE, newLedger } from './helpers.ts';

type FakeTx = DecodedTx & { touches: string[] };

// Fake chain: signatures per address and block order come from the tx list.
function fakeRpc(txs: FakeTx[], finalized: number) {
  return {
    finalizedSlot: async () => finalized,
    signatures: async (address: string, from: number, to: number) =>
      txs.filter((t) => t.touches.includes(address) && t.slot >= from && t.slot <= to)
        .reverse().map((t) => ({ signature: t.signature, slot: t.slot, err: null })),
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
  assert.deepEqual(applied, ['buy', 'b-sell', 'sellback']);
  assert.equal(n, 3);
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
