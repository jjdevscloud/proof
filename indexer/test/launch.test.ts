import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLaunch } from '../src/launch.ts';

const T = 1_000_000n;
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// A pump.fun curve after `sold` tokens were bought: virtual and real reserves both drop by `sold`.
function curveData(sold: bigint, totalSupply = 1_000_000_000n * T) {
  const b = Buffer.alloc(150);
  b.writeBigUInt64LE(1_073_000_000n * T - sold, 8);
  b.writeBigUInt64LE(30_000_000_000n, 16);
  b.writeBigUInt64LE(793_100_000n * T - sold, 24);
  b.writeBigUInt64LE(0n, 32);
  b.writeBigUInt64LE(totalSupply, 40);
  return b.toString('base64');
}

type Opts = { supply?: bigint; sold?: bigint; balanceExtra?: bigint; curveSupply?: bigint; mintAuthority?: string | null; extensions?: string[] };
function fakeRpc(o: Opts) {
  const sold = o.sold ?? 0n;
  return {
    call: async (_m: string, [address]: [string]) => {
      if (address === 'MINT') {
        return { value: { owner: T22, data: { parsed: { info: {
          decimals: 6, supply: (o.supply ?? 1_000_000_000n * T).toString(), mintAuthority: o.mintAuthority ?? null, freezeAuthority: null,
          extensions: (o.extensions ?? ['metadataPointer', 'tokenMetadata']).map((extension) => ({ extension })),
        } } } } };
      }
      if (address === 'CURVE_ATA') {
        const amount = (1_000_000_000n * T - sold + (o.balanceExtra ?? 0n)).toString();
        return { value: { owner: T22, data: { parsed: { info: { mint: 'MINT', owner: 'CURVE_PDA', tokenAmount: { amount } } } } } };
      }
      if (address === 'CURVE_PDA') return { value: { owner: PUMP, data: [curveData(sold, o.curveSupply), 'base64'] } };
      return { value: null };
    },
  } as any;
}
const run = (o: Opts) => checkLaunch(fakeRpc(o), { mint: 'MINT', curveTokenAccount: 'CURVE_ATA' }, PUMP, 793_100_000n * T);

test('a standard pump.fun token passes, before and after buys', async () => {
  assert.deepEqual(await run({}), []);
  assert.deepEqual(await run({ sold: 123_456_789n * T }), []);
});

test('burns and tokens sent into the curve account cannot block the launch', async () => {
  assert.deepEqual(await run({ supply: 999_999_999n * T, sold: 5n * T }), []);
  assert.deepEqual(await run({ balanceExtra: 1n * T, sold: 40n * T }), []);
});

test('wrong tokens are refused', async () => {
  assert.match((await run({ supply: 2_000_000_000n * T })).join(), /supply/); // Mayhem Mode mints 2B
  assert.match((await run({ curveSupply: 2_000_000_000n * T })).join(), /curve total supply/);
  assert.match((await run({ mintAuthority: 'someone' })).join(), /mint authority/);
  assert.match((await run({ extensions: ['transferFeeConfig'] })).join(), /extensions/);
});
