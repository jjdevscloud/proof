// Step 1: create the devnet keypairs (payer, mint, reveal authority, test wallets).
import { WALLETS, key } from './lib.ts';

for (const name of WALLETS) console.log(`${name.padEnd(12)} ${key(name).publicKey.toBase58()}`);
console.log('\nBuild the program for devnet (feature "devnet": the payer above is the launch authority).');
