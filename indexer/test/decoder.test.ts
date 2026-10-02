import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Decoder, anchorDiscriminator } from '../src/decoder.ts';
import { decodeBase58, encodeBase58 } from '../src/base58.ts';

const MINT = 'PRooFMint1111111111111111111111111111111111';
const CURVE = 'CurveAta11111111111111111111111111111111111';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const VAULT_PROGRAM = 'VauLt11111111111111111111111111111111111111';
const AUTH = 'Auth111111111111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const decoder = new Decoder({
  mint: MINT, curveTokenAccount: CURVE, pumpProgramId: PUMP, pumpNonBuyInstructions: ['migrate', 'withdraw'],
  vaultProgramId: VAULT_PROGRAM, revealAuthority: AUTH,
});

function ixData(name: string, args: Uint8Array = new Uint8Array()): string {
  return encodeBase58(Buffer.concat([Buffer.from(anchorDiscriminator(name), 'hex'), args]));
}
function u64(n: bigint) { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; }
function u32(n: number) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }

function bal(i: number, owner: string, amount: bigint, mint = MINT) {
  return { accountIndex: i, mint, owner, programId: TOKEN, uiTokenAmount: { amount: amount.toString(), decimals: 6 } };
}

function tx(opts: { keys: { pubkey: string; signer?: boolean }[]; ixs: any[]; inner?: any[]; pre?: any[]; post?: any[]; err?: any }) {
  return {
    slot: 42,
    transaction: {
      signatures: ['sigX'],
      message: { accountKeys: opts.keys.map((k) => ({ signer: false, writable: true, source: 'transaction', ...k })), instructions: opts.ixs },
    },
    meta: { err: opts.err ?? null, innerInstructions: opts.inner ?? [], preTokenBalances: opts.pre ?? [], postTokenBalances: opts.post ?? [] },
  };
}

const transfer = (source: string, destination: string, amount: bigint, stackHeight?: number) => ({
  program: 'spl-token', programId: TOKEN, stackHeight, parsed: { type: 'transfer', info: { source, destination, authority: 'x', amount: amount.toString() } },
});

test('base58 round-trips including leading zeros', () => {
  const bytes = Uint8Array.from([0, 0, 1, 2, 255]);
  assert.deepEqual(decodeBase58(encodeBase58(bytes)), bytes);
});

test('a pump buy routed through another program is a curve buy', () => {
  const t = tx({
    keys: [{ pubkey: 'user', signer: true }, { pubkey: CURVE }, { pubkey: 'A' }],
    ixs: [{ programId: 'Router1111111111111111111111111111111111111', accounts: [], data: '1', stackHeight: null }],
    inner: [{ index: 0, instructions: [
      { programId: PUMP, accounts: [], data: ixData('buy', u64(5n)), stackHeight: 2 },
      transfer(CURVE, 'A', 1000n, 3),
    ] }],
    pre: [bal(1, 'bondingCurve', 5000n)],
    post: [bal(1, 'bondingCurve', 4000n), bal(2, 'user', 1000n)],
  });
  const d = decoder.decode(t)!;
  assert.deepEqual(d.events, [{ kind: 'curveBuy', to: 'A', amount: 1000n }]);
  assert.deepEqual(d.post[1], { account: 'A', owner: 'user', balance: 1000n });
});

test('new pump buy variants (buy_v2, buy_exact_quote_in_v2) are curve buys without config changes', () => {
  for (const name of ['buy_v2', 'buy_exact_quote_in_v2']) {
    const t = tx({
      keys: [{ pubkey: 'user', signer: true }, { pubkey: CURVE }, { pubkey: 'A' }],
      ixs: [{ programId: PUMP, accounts: [], data: ixData(name, u64(5n)), stackHeight: null }],
      inner: [{ index: 0, instructions: [transfer(CURVE, 'A', 10n, 2)] }],
      pre: [bal(1, 'bondingCurve', 50n)],
      post: [bal(1, 'bondingCurve', 40n), bal(2, 'user', 10n)],
    });
    assert.deepEqual(decoder.decode(t)!.events, [{ kind: 'curveBuy', to: 'A', amount: 10n }], name);
  }
});

test('a transfer out of the curve under a non-buy pump instruction is a plain transfer', () => {
  const t = tx({
    keys: [{ pubkey: 'x', signer: true }, { pubkey: CURVE }, { pubkey: 'POOL' }],
    ixs: [{ programId: PUMP, accounts: [], data: ixData('migrate'), stackHeight: null }],
    inner: [{ index: 0, instructions: [transfer(CURVE, 'POOL', 7n, 2)] }],
    pre: [bal(1, 'bc', 7n)], post: [bal(1, 'bc', 0n), bal(2, 'amm', 7n)],
  });
  assert.deepEqual(decoder.decode(t)!.events, [{ kind: 'transfer', from: CURVE, to: 'POOL', amount: 7n }]);
});

test('legacy transfer without a mint field is caught via token balances; other mints ignored', () => {
  const t = tx({
    keys: [{ pubkey: 'user', signer: true }, { pubkey: 'A' }, { pubkey: 'POOL' }, { pubkey: 'U1' }, { pubkey: 'U2' }],
    ixs: [transfer('A', 'POOL', 10n), transfer('U1', 'U2', 99n)],
    pre: [bal(1, 'user', 10n), bal(2, 'amm', 0n), bal(3, 'user', 99n, 'OtherMint'), bal(4, 'z', 0n, 'OtherMint')],
    post: [bal(1, 'user', 0n), bal(2, 'amm', 10n)],
  });
  assert.deepEqual(decoder.decode(t)!.events, [{ kind: 'transfer', from: 'A', to: 'POOL', amount: 10n }]);
});

test('seal decodes ranges from instruction data; list/buy/gift/withdraw decode', () => {
  const sealData = ixData('seal', Buffer.concat([u32(2), u64(10n), u64(5n), u64(100n), u64(1n)]));
  const accts = ['holder', 'config', 'ENV', 'VAULT', 'SRC', MINT, TOKEN, '11111111111111111111111111111111'];
  const seal = tx({
    keys: [{ pubkey: 'holder', signer: true }, { pubkey: 'SRC' }, { pubkey: 'VAULT' }],
    ixs: [{ programId: VAULT_PROGRAM, accounts: accts, data: sealData, stackHeight: null }],
    inner: [{ index: 0, instructions: [
      { program: 'spl-token', programId: TOKEN, stackHeight: 2, parsed: { type: 'initializeAccount3', info: {} } },
      { program: 'spl-token', programId: TOKEN, stackHeight: 2, parsed: { type: 'transferChecked', info: { source: 'SRC', destination: 'VAULT', mint: MINT, authority: 'holder', tokenAmount: { amount: '6' } } } },
    ] }],
    pre: [bal(1, 'holder', 6n)], post: [bal(1, 'holder', 0n), bal(2, 'ENV', 6n)],
  });
  assert.deepEqual(decoder.decode(seal)!.events, [{
    kind: 'seal', from: 'SRC', holder: 'holder', envelope: 'ENV', vault: 'VAULT', amount: 6n,
    ranges: [{ start: 10n, end: 15n }, { start: 100n, end: 101n }],
  }]);

  const giftTo = encodeBase58(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
  const misc = tx({
    keys: [{ pubkey: 'buyer', signer: true }],
    ixs: [
      { programId: VAULT_PROGRAM, accounts: ['holder', 'ENV'], data: ixData('list', u64(400n)) },
      { programId: VAULT_PROGRAM, accounts: ['buyer', 'holder', 'ENV', '11111111111111111111111111111111'], data: ixData('buy', u64(400n)) },
      { programId: VAULT_PROGRAM, accounts: ['buyer', 'ENV'], data: ixData('gift', decodeBase58(giftTo)) },
      { programId: VAULT_PROGRAM, accounts: ['holder', 'ENV'], data: ixData('cancel') },
    ],
  });
  assert.deepEqual(decoder.decode(misc)!.events, [
    { kind: 'list', envelope: 'ENV', price: 400n },
    { kind: 'sale', envelope: 'ENV', buyer: 'buyer' },
    { kind: 'gift', envelope: 'ENV', to: giftTo },
    { kind: 'cancel', envelope: 'ENV' },
  ]);

  const withdraw = tx({
    keys: [{ pubkey: 'holder', signer: true }, { pubkey: 'VAULT' }, { pubkey: 'DEST' }],
    ixs: [{ programId: VAULT_PROGRAM, accounts: ['holder', 'ENV', 'VAULT', 'DEST', MINT, TOKEN], data: ixData('withdraw') }],
    inner: [{ index: 0, instructions: [
      transfer('VAULT', 'DEST', 6n, 2),
      { program: 'spl-token', programId: TOKEN, stackHeight: 2, parsed: { type: 'closeAccount', info: { account: 'VAULT' } } },
    ] }],
    pre: [bal(1, 'ENV', 6n), bal(2, 'holder', 0n)], post: [bal(2, 'holder', 6n)],
  });
  assert.deepEqual(decoder.decode(withdraw)!.events, [{ kind: 'withdraw', envelope: 'ENV', to: 'DEST', amount: 6n }]);
});

test('owner change and burn', () => {
  const t = tx({
    keys: [{ pubkey: 'user', signer: true }, { pubkey: 'A' }],
    ixs: [
      { program: 'spl-token', programId: TOKEN, parsed: { type: 'burn', info: { account: 'A', amount: '3' } } },
      { program: 'spl-token', programId: TOKEN, parsed: { type: 'setAuthority', info: { account: 'A', authorityType: 'accountOwner', newAuthority: 'bob' } } },
      { program: 'spl-token', programId: TOKEN, parsed: { type: 'setAuthority', info: { account: 'A', authorityType: 'closeAccount', newAuthority: 'bob' } } },
    ],
    pre: [bal(1, 'user', 10n)], post: [bal(1, 'bob', 7n)],
  });
  assert.deepEqual(decoder.decode(t)!.events, [
    { kind: 'burn', from: 'A', amount: 3n },
    { kind: 'ownerChange', account: 'A', newOwner: 'bob' },
  ]);
});

test('commit/reveal memos count only when the reveal authority signs', () => {
  const root = 'ab'.repeat(32);
  const memo = { program: 'spl-memo', programId: MEMO, parsed: `proof:v1:commit:${root}` };
  const signed = tx({ keys: [{ pubkey: AUTH, signer: true }], ixs: [memo] });
  assert.deepEqual(decoder.decode(signed)!.events, [{ kind: 'commit', root }]);
  const unsigned = tx({ keys: [{ pubkey: 'someone', signer: true }, { pubkey: AUTH }], ixs: [memo] });
  assert.deepEqual(decoder.decode(unsigned)!.events, []);
});

test('failed transactions are skipped', () => {
  const t = tx({ keys: [{ pubkey: 'A' }], ixs: [transfer('A', 'B', 1n)], err: { InstructionError: [0, 'Custom'] } });
  assert.equal(decoder.decode(t), null);
});
