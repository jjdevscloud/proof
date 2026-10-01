// Step 1: create devnet keypairs and point the program's PROOF_MINT at the devnet mint.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, WALLETS, key } from './lib.ts';

for (const name of WALLETS) console.log(`${name.padEnd(12)} ${key(name).publicKey.toBase58()}`);

const lib = join(REPO, 'programs', 'proof-vault', 'src', 'lib.rs');
const src = readFileSync(lib, 'utf8');
const mint = key('mint').publicKey.toBase58();
const next = src.replace(/pub const PROOF_MINT: Pubkey = pubkey!\("[1-9A-HJ-NP-Za-km-z]+"\);/, `pub const PROOF_MINT: Pubkey = pubkey!("${mint}");`);
if (next === src && !src.includes(mint)) throw new Error('PROOF_MINT line not found');
writeFileSync(lib, next);
console.log(`\nPROOF_MINT set to ${mint} (devnet). Reset it before a mainnet build.`);
