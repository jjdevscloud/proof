// Launch step 3b (after the program is deployed): create the vault's config account once.
//   node init-vault.ts --program <program id> --key <payer.json> --rpc <url>
import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { args, connection, loadKey, need } from './common.ts';

const a = args();
const conn = connection(a);
const program = new PublicKey(need(a, 'program'));
const payer = loadKey(need(a, 'key'));
const config = PublicKey.findProgramAddressSync([Buffer.from('config')], program)[0];

if (await conn.getAccountInfo(config)) {
  console.log(`vault config already exists: ${config.toBase58()}`);
} else {
  const ix = new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: createHash('sha256').update('global:initialize').digest().subarray(0, 8),
  });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer], { commitment: 'confirmed' });
  console.log(`vault config created: ${config.toBase58()} (${sig})`);
}
