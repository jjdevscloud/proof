// Step 6: check the indexer's view against expectations computed by hand from scenario.ts.
// Usage: node verify.ts [http://localhost:8787] [http://localhost:8788]
import assert from 'node:assert/strict';
import { key, loadState } from './lib.ts';

const apis = process.argv.slice(2).length ? process.argv.slice(2) : ['http://localhost:8787', 'http://localhost:8788'];
const state = loadState();
const M = 1_000_000n * 1_000_000n; // one million tokens in base units
const tok = (n: bigint) => (n * 1_000_000n).toString();
const get = async (base: string, path: string) => {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<any>;
};
const segs = (xs: any[]) => xs.map((s) => [s.strike, s.start, s.end]);

let failures = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${(e as Error).message.split('\n').join('\n        ')}`);
  }
}

const fingerprints: string[] = [];
for (const base of apis) {
  console.log(`\n${base}`);
  for (let i = 0; ; i++) {
    const h = await get(base, '/health');
    if (h.syncedSlot >= state.lastSlot) break;
    if (i === 0) console.log(`  waiting for slot ${state.lastSlot} (at ${h.syncedSlot})...`);
    if (i > 120) throw new Error('indexer did not catch up within 6 minutes');
    await new Promise((r) => setTimeout(r, 3000));
  }
  const health = await get(base, '/health');
  fingerprints.push(health.fingerprint);
  const pk = (n: Parameters<typeof key>[0]) => key(n).publicKey.toBase58();

  await check('revealed', async () => assert.equal(health.revealed, true));

  await check('alice: strike 1 [1,000,000 – 1,899,990) remains; invalid envelope E2 holds 10 common', async () => {
    const w = await get(base, `/wallet/${pk('alice')}`);
    assert.deepEqual(w.accounts.map((a: any) => a.account), [state.accounts.A]);
    // 600k post-reveal outflow: all of strike 2 (rank 2) left before strike 1 (rank 7).
    assert.deepEqual(segs(w.accounts[0].segments), [[1, tok(1_000_000n), tok(1_899_990n)]]);
    assert.deepEqual(w.accounts[0].segments[0].traits, ['Genesis', 'Double Die']);
    assert.deepEqual(w.envelopes.map((e: any) => [e.address, e.segments.length]), [[state.envelopes.E2, 0]]);
    const e2 = await get(base, `/envelope/${state.envelopes.E2}`);
    assert.equal(e2.common, tok(10n));
  });

  await check('bob: strike 3 [3,000,000 – 4,000,000); withdrawn strike 0 melted', async () => {
    const w = await get(base, `/wallet/${pk('bob')}`);
    assert.deepEqual(w.accounts.map((a: any) => segs(a.segments)), [[[3, tok(3_000_000n), tok(4_000_000n)]]]);
    assert.equal(w.envelopes.length, 0);
  });

  await check('carol: returned tokens were common, fresh [4,500,000 – 5,000,000)', async () => {
    const w = await get(base, `/wallet/${pk('carol')}`);
    assert.deepEqual(w.accounts.map((a: any) => segs(a.segments)), [[[4, tok(4_500_000n), tok(5_000_000n)]]]);
  });

  await check('dave/erin: owner change melted strike 5', async () => {
    for (const n of ['dave', 'erin'] as const) {
      const w = await get(base, `/wallet/${pk(n)}`);
      assert.equal(w.accounts.length + w.envelopes.length, 0, n);
    }
    const s5 = await get(base, '/strike/5');
    assert.deepEqual([s5.issued, s5.surviving], [M.toString(), '0']);
  });

  await check('pool holds nothing rare; migration issued no positions', async () => {
    const w = await get(base, `/wallet/${pk('pool')}`);
    assert.equal(w.accounts.length, 0);
    const s6 = await get(base, '/strike/6');
    assert.equal(s6.issued, '0');
  });

  await check('strike totals', async () => {
    const s = await get(base, '/strikes');
    const surviving = s.slice(0, 6).map((x: any) => x.surviving);
    assert.deepEqual(surviving, ['0', tok(899_990n), '0', M.toString(), tok(500_000n), '0']);
  });

  await check('no envelope listed', async () => {
    assert.deepEqual(await get(base, '/envelopes?status=listed'), []);
  });
}

if (fingerprints.length > 1) {
  await check('independent indexers agree on the fingerprint', async () => {
    assert.ok(fingerprints.every((f) => f === fingerprints[0]), fingerprints.join(' vs '));
  });
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
