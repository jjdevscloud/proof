import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApi } from '../src/api.ts';
import { Chain, r } from './helpers.ts';

test('wallet, envelope, preview and strike endpoints', async () => {
  const c = new Chain();
  c.tx([{ kind: 'curveBuy', to: 'A', amount: 100n }]);
  c.tx([{ kind: 'seal', from: 'A', holder: 'alice', envelope: 'E1', vault: 'V1', ranges: [r(0n, 10n)], amount: 10n }]);
  c.tx([{ kind: 'list', envelope: 'E1', price: 400n }]);
  const { server } = createApi({
    ledger: c.ledger,
    syncedSlot: () => 99,
    publicConfig: { mint: 'M', vaultProgramId: 'V', curveTokenAccount: 'C', revealAuthority: 'R' },
  });
  await new Promise<void>((res) => server.listen(0, res));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (p: string) => (await fetch(base + p)).json() as Promise<any>;
  try {
    const listed = await get('/envelopes?status=listed');
    assert.deepEqual(listed.map((e: any) => [e.address, e.price, e.ranges]), [['E1', '400', [{ start: '0', end: '10' }]]]);
    const w = await get('/wallet/owner-of-A');
    assert.equal(w.accounts[0].segments[0].start, '10');
    const pv = await get('/preview?account=A&amount=5');
    assert.deepEqual([pv.fromMelted, pv.ranges, pv.segments[0].strike], ['0', [{ start: '95', end: '100' }], 0]);
    assert.equal((await get('/stats')).surviving, '100');
    assert.equal((await get('/config')).mint, 'M');
    assert.equal((await get('/strike/0')).surviving, '100');
    assert.equal((await get('/health')).syncedSlot, 99);
    assert.equal((await fetch(base + '/strike/9999')).status, 404);
  } finally {
    server.close();
  }
});
