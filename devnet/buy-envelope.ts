// Buy a listed envelope with a devnet test wallet.
// Usage: node buy-envelope.ts <envelope address> <buyer wallet name, default carol>
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { buyEnvelopeIx, connection, key, programId, send } from './lib.ts';
import type { WalletName } from './lib.ts';

const envelope = new PublicKey(process.argv[2] ?? '');
const buyer = key((process.argv[3] ?? 'carol') as WalletName);
const payer = key('payer');

const info = await connection.getAccountInfo(envelope);
if (!info || !info.owner.equals(programId('proof_vault'))) throw new Error('not a proof_vault envelope');
// Envelope layout: disc 8 | id 8 | holder 32 | vault 32 | amount 8 | status 1 | price 8 | ...
const holder = new PublicKey(info.data.subarray(16, 48));
const status = info.data[88];
const price = info.data.readBigUInt64LE(89);
if (status !== 1) throw new Error('envelope is not listed');
console.log(`listed by ${holder.toBase58()} for ${Number(price) / LAMPORTS_PER_SOL} SOL`);

const need = price + BigInt(0.01 * LAMPORTS_PER_SOL);
const have = BigInt(await connection.getBalance(buyer.publicKey));
if (have < need) {
  await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: buyer.publicKey, lamports: need - have })], [payer], 'top up buyer');
}
const before = await connection.getBalance(holder);
await send([buyEnvelopeIx(buyer.publicKey, holder, envelope, price)], [buyer], `buy envelope as ${buyer.publicKey.toBase58().slice(0, 4)}…`);
const after = await connection.getBalance(holder);
console.log(`seller received ${(after - before) / LAMPORTS_PER_SOL} SOL; new holder ${buyer.publicKey.toBase58()}`);
