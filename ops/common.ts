// Shared helpers for the launch tools.
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// --flag value pairs and bare --switches.
export function args(): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) throw new Error(`unexpected argument ${a[i]}`);
    const next = a[i + 1];
    if (next === undefined || next.startsWith('--')) out[a[i].slice(2)] = true;
    else out[a[i].slice(2)] = a[++i];
  }
  return out;
}

export function need(a: Record<string, string | true>, k: string): string {
  const v = a[k];
  if (typeof v !== 'string') throw new Error(`--${k} is required`);
  return v;
}

export function connection(a: Record<string, string | true>): Connection {
  const url = typeof a.rpc === 'string' ? a.rpc : process.env.RPC_URL;
  if (!url) throw new Error('set --rpc or RPC_URL (use a reliable mainnet RPC on launch day)');
  return new Connection(url, 'confirmed');
}

export function loadKey(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}

export async function postMemo(conn: Connection, signer: Keypair, text: string): Promise<{ signature: string; slot: number }> {
  const ix = new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(text, 'utf8') });
  const signature = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [signer], { commitment: 'finalized' });
  const status = await conn.getSignatureStatus(signature, { searchTransactionHistory: true });
  return { signature, slot: status.value!.slot };
}

// The first produced block at or after `slot`, with its hash.
export async function firstBlockFrom(conn: Connection, slot: number): Promise<{ slot: number; blockhash: string }> {
  const slots = await conn.getBlocks(slot, slot + 500, 'finalized');
  if (!slots.length) throw new Error(`no finalized block yet at or after slot ${slot}`);
  const block = await conn.getBlock(slots[0], { transactionDetails: 'none', rewards: false, maxSupportedTransactionVersion: 1, commitment: 'finalized' });
  return { slot: slots[0], blockhash: block!.blockhash };
}
