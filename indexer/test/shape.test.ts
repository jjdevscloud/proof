// The website reads these response shapes; demo data once hid a missing field, so they are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApi } from '../src/api.ts';
import { Ledger } from '../src/ledger.ts';
import { parseRules } from '../src/derive.ts';
import { Chain, r } from './helpers.ts';

const publicConfig = { mint: 'M', vaultProgramId: 'V', curveTokenAccount: 'C', curveProgramId: 'P', revealAuthority: 'R', treasury: 'TR', feeBps: 150 };
const roll = parseRules(readFileSync(new URL('../../rules/sequents-v1.template.json', import.meta.url), 'utf8').replace('"deadlineSlot": 0', '"deadlineSlot": 1')).roll!;

test('envelope shape is the same on /wallet, /envelopes and /envelope; /rolls and /config carry roll data', async () => {
  const c = new Chain(new Ledger({ curveTokenAccount: 'CURVE', saleableSupply: 793_100_000n * 1_000_000n, strikeSize: 1_000_000n * 1_000_000n, roll }));
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 100n }]);
  c.tx([{ kind: 'seal', from: 'A', holder: 'alice', envelope: 'E0', vault: 'V0', ranges: [r(0n, 10n)], amount: 10n }]);
  c.balances.set('X', 60_000_000_000n);
  c.tx([{ kind: 'transfer', from: 'X', to: 'A', amount: 60_000_000_000n }]);
  const big = 1n << 62n;
  const sealed = c.tx([
    { kind: 'lamports', from: 'alice', to: roll.treasury, lamports: BigInt(roll.feeLamports) },
    { kind: 'seal', from: 'A', holder: 'alice', envelope: 'E1', vault: 'V1', ranges: [r(big, big + 60_000_000_000n)], amount: 60_000_000_000n },
    { kind: 'roll', envelope: 'E1' },
  ]);
  const history = [sealed, c.ledger.settleRoll('E1', c.slot + 5, 'HASH')];
  c.tx([{ kind: 'list', envelope: 'E1', price: 7n }]);
  const { server } = createApi({ ledger: c.ledger, syncedSlot: () => 99, history, publicConfig });
  await new Promise<void>((res) => server.listen(0, res));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (p: string) => (await fetch(base + p)).json() as Promise<any>;
  try {
    const fields = ['address', 'vault', 'holder', 'status', 'price', 'sealedSlot', 'roll', 'rolling', 'ranges', 'common', 'segments'];
    const wallet = (await get('/wallet/alice')).envelopes;
    const list = await get('/envelopes');
    for (const id of ['E0', 'E1']) {
      const views = { wallet: wallet.find((e: any) => e.address === id), envelopes: list.find((e: any) => e.address === id), envelope: await get(`/envelope/${id}`) };
      for (const [name, e] of Object.entries(views)) {
        for (const f of fields) assert.ok(e && f in e, `/${name} envelope ${id} lacks ${f}`);
      }
      assert.deepEqual(views.wallet.ranges, views.envelope.ranges);
    }
    const e1 = await get('/envelope/E1');
    assert.deepEqual(e1.ranges, []);
    assert.equal(e1.common, '60000000000');
    assert.equal(e1.roll.signature, sealed.signature);
    assert.deepEqual((await get('/envelope/E0')).ranges, [{ start: '0', end: '10' }]);
    const rolls = await get('/rolls');
    assert.equal(rolls.total, 1);
    assert.deepEqual(rolls.held[e1.roll.name], { count: 1, listed: 1, floor: '7' });
    assert.equal(rolls.recent[0].envelope, 'E1');
    assert.equal((await get('/config')).roll.feeLamports, roll.feeLamports);
    const act = await get('/activity');
    assert.ok(act.some((t: any) => t.changes.some((ch: any) => ch.kind === 'rolled')));
  } finally {
    server.close();
  }
});

test('the /rpc proxy allows only the light methods; getSignaturesForAddress only with limit 1', async () => {
  const upstream = createServer((_q, s) => s.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'upstream' })));
  await new Promise<void>((res) => upstream.listen(0, res));
  const c = new Chain();
  const { server } = createApi({ ledger: c.ledger, syncedSlot: () => 0, rpcUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, publicConfig });
  await new Promise<void>((res) => server.listen(0, res));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const call = async (method: string, params: unknown[] = []) =>
    (await fetch(base, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).status;
  try {
    assert.equal(await call('getAccountInfo', ['x']), 200);
    assert.equal(await call('sendTransaction', ['x']), 200);
    assert.equal(await call('getSignaturesForAddress', ['x', { limit: 1 }]), 200);
    assert.equal(await call('getSignaturesForAddress', ['x', { limit: 1000 }]), 403);
    assert.equal(await call('getSignaturesForAddress', ['x']), 403);
    assert.equal(await call('getBlock', [1, { transactionDetails: 'none' }]), 200);
    assert.equal(await call('getBlock', [1, { transactionDetails: 'full' }]), 403);
    assert.equal(await call('getProgramAccounts', ['x']), 403);
    assert.equal(await call('getTransaction', ['x']), 403);
  } finally {
    server.close();
    upstream.close();
  }
});
