// The roll (SPEC §4.5) end to end on a local validator, after setup.ts with the indexer running
// (RULES_FILE pointing at rules.localnet.json). Real transactions: seal & roll in one, roll again,
// and rolls that must not count. Each settled result is compared with the browser's computation.
import { readFileSync } from 'node:fs';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, transferChecked } from '@solana/spl-token';
import { DECIMALS, INDEXER_URL, RULES_PATH, T, connection, curveBuyIx, envelopePdas, key, memoIx, nextEnvelopeId, send, sealIx } from './lib.ts';
import { parseRules, rollResult } from '../indexer/src/derive.ts';

const roll = parseRules(readFileSync(RULES_PATH, 'utf8')).roll!;
const TREASURY = new PublicKey(roll.treasury);
const FEE = BigInt(roll.feeLamports);
const ORDINARY = 1n << 62n;
const mint = key('mint').publicKey;
const [payer, alice, bob, dave] = (['payer', 'alice', 'bob', 'dave'] as const).map(key);
const ata = async (owner: typeof alice) => (await getOrCreateAssociatedTokenAccount(connection, payer, mint, owner.publicKey)).address;
const A = await ata(alice);
const D = await ata(dave);

const fee = (from: typeof alice, lamports = FEE) => SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: TREASURY, lamports });
const rollMemo = (envelope: PublicKey, signer: typeof alice) => memoIx(`proof:v1:roll:${envelope.toBase58()}`, signer.publicKey);

// What the website computes: the first confirmed block at or after the roll's slot + delay.
async function browserResult(signature: string) {
  const st = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]!;
  for (;;) {
    const slots = await connection.getBlocks(st.slot + roll.seedDelaySlots, st.slot + roll.seedDelaySlots + 100, 'confirmed');
    if (slots.length) {
      const b = await connection.getBlock(slots[0], { commitment: 'confirmed', transactionDetails: 'none', rewards: false, maxSupportedTransactionVersion: 0 });
      return rollResult(roll, signature, b!.blockhash);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function indexed(envelope: PublicKey, until: (e: any) => boolean): Promise<any> {
  for (let i = 0; i < 120; i++) {
    const res = await fetch(`${INDEXER_URL}/envelope/${envelope.toBase58()}`);
    if (res.ok) {
      const e = await res.json();
      if (until(e)) return e;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`indexer never showed the expected state for ${envelope.toBase58()}`);
}

async function activityFor(envelope: PublicKey, kind: string): Promise<any[]> {
  const list = await (await fetch(`${INDEXER_URL}/activity?limit=500`)).json();
  return list.flatMap((t: any) => t.changes).filter((c: any) => c.envelope === envelope.toBase58() && c.kind === kind);
}

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

// Local validator: enough SOL for several roll fees.
for (const kp of [dave, bob]) await connection.confirmTransaction(await connection.requestAirdrop(kp.publicKey, 1e9), 'confirmed');

// Dave gets ordinary $PROOF: Alice buys off the curve and sends him some.
await send([curveBuyIx(alice.publicKey, mint, A, 200_000n * T)], [alice], 'alice buys 200,000');
await transferChecked(connection, alice, A, mint, D, alice, 130_000n * T, DECIMALS);
console.log('  alice sent dave 130,000 (ordinary)');

// 1. Seal 60,000 and roll, one transaction.
const id1 = await nextEnvelopeId();
const E1 = envelopePdas(id1).envelope;
const sig1 = await send([
  sealIx(dave.publicKey, id1, D, mint, [{ start: ORDINARY, len: 60_000n * T }]), fee(dave), rollMemo(E1, dave),
], [dave], 'dave seals 60,000 & rolls');
const want1 = await browserResult(sig1);
const got1 = await indexed(E1, (e) => !!e.roll);
check('seal & roll settles to what the browser computed', got1.roll.name === want1.name && got1.roll.signature === sig1, `${want1.name}`);
check('envelope has no rare Strikes and 60,000 ordinary', got1.ranges.length === 0 && got1.common === (60_000n * T).toString());

// 2. Roll again: allowed only if the first result was the fallback.
const sig2 = await send([fee(dave), rollMemo(E1, dave)], [dave], 'dave rolls again');
if (got1.roll.points === 0) {
  const want2 = await browserResult(sig2);
  const got2 = await indexed(E1, (e) => e.roll?.signature === sig2);
  check('roll again settles to what the browser computed', got2.roll.name === want2.name, want2.name);
} else {
  await indexed(E1, () => true);
  await new Promise((r) => setTimeout(r, 20_000));
  const rejected = await activityFor(E1, 'roll');
  check('a rare envelope cannot roll again', rejected.some((c) => c.reason === 'envelope already holds a rare roll'));
}

// 3. Rolls that must not count.
const id3 = await nextEnvelopeId();
const E3 = envelopePdas(id3).envelope;
await send([sealIx(dave.publicKey, id3, D, mint, [{ start: ORDINARY, len: 60_000n * T }])], [dave], 'dave seals another 60,000');
await send([fee(bob), rollMemo(E3, bob)], [bob], 'bob pays for dave\'s envelope');
await send([fee(dave, FEE - 1n), rollMemo(E3, dave)], [dave], 'dave underpays');
const id4 = await nextEnvelopeId();
const E4 = envelopePdas(id4).envelope;
await send([sealIx(dave.publicKey, id4, D, mint, [{ start: ORDINARY, len: 10_000n * T }]), fee(dave), rollMemo(E4, dave)], [dave], 'dave seals 10,000 & rolls');
await indexed(E4, () => true);
for (let i = 0; i < 60 && (await activityFor(E4, 'roll')).length === 0; i++) await new Promise((r) => setTimeout(r, 1000));
const r3 = (await activityFor(E3, 'roll')).map((c) => c.reason);
check('fee paid by someone else does not count', r3.filter((x) => x === 'fee not paid by the holder').length === 2, r3.join('; '));
check('below the minimum does not count', (await activityFor(E4, 'roll'))[0]?.reason === 'envelope holds less than the minimum');
const e3 = await indexed(E3, () => true);
check('rejected rolls leave the envelope unrolled', e3.roll === null && e3.rolling === null);
const seals = await activityFor(E1, 'seal');
check('ordinary seal shows as ordinary, not as a failed seal', seals[0]?.ordinary === (60_000n * T).toString());

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall roll checks passed');
process.exit(failures ? 1 : 0);
