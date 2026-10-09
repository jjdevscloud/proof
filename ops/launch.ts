// Launch day, right after the token is created on pump.fun: check the token against the committed
// rules and record its mint in the vault program (set_mint). The live site picks the record up
// within seconds and switches from "launching soon" to live: no config edit, no redeploy.
//
// Either give the mint, or start this BEFORE creating the token and let it watch your creator wallet:
//   node launch.ts --mint <mint> --key <deployer.json> --rpc <url>
//   node launch.ts --watch <creator wallet> --key <deployer.json> --rpc <url>
//
// Requires the commit memo to be posted first (make-commit.ts --post) and the vault program deployed.
import { existsSync, readFileSync } from 'node:fs';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { Rpc } from '../indexer/src/rpc.ts';
import { checkLaunch, findMintRecord } from '../indexer/src/launch.ts';
import { args, connection, loadKey, need } from './common.ts';

const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SALEABLE = 793_100_000n * 1_000_000n;

const a = args();
const conn = connection(a);
const rpc = new Rpc(conn.rpcEndpoint);
const authority = loadKey(need(a, 'key'));
const indexerConfig = JSON.parse(readFileSync('../indexer/config.mainnet.json', 'utf8'));
const vaultProgram = new PublicKey(indexerConfig.vaultProgramId);
const symbol = typeof a.symbol === 'string' ? a.symbol : 'PROOF';

// The committed rules and start slot must already be in the deployed config (make-commit --post, then deploy).
if (!(indexerConfig.startSlot > 0)) throw new Error('indexer/config.mainnet.json has no startSlot: run make-commit.ts --post and deploy first');
if (!existsSync('../rules/sequents-v1.json')) throw new Error('rules/sequents-v1.json missing: run make-commit.ts --post first');
if (!(await conn.getAccountInfo(vaultProgram))) throw new Error(`vault program ${vaultProgram.toBase58()} is not deployed`);
const existing = await findMintRecord(rpc, vaultProgram.toBase58());
if (existing) {
  console.log(`mint already recorded: ${existing.mint} (curve token account ${existing.curveTokenAccount})`);
  process.exit(0);
}

const curveTokensOf = async (mint: PublicKey) => {
  const tokenProgram = (await conn.getAccountInfo(mint))?.owner.equals(TOKEN_2022) ? TOKEN_2022 : TOKEN;
  const bondingCurve = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], PUMP)[0];
  return PublicKey.findProgramAddressSync([bondingCurve.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
};

// Watches the creator wallet for a new transaction holding a mint whose metadata symbol matches.
async function watch(creator: PublicKey): Promise<PublicKey> {
  const seen = new Set((await conn.getSignaturesForAddress(creator, { limit: 20 })).map((s) => s.signature));
  console.log(`watching ${creator.toBase58()} for a new ${symbol} token... create it on pump.fun now`);
  for (;;) {
    for (const s of await conn.getSignaturesForAddress(creator, { limit: 20 })) {
      if (seen.has(s.signature)) continue;
      seen.add(s.signature);
      if (s.err) continue;
      const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 1, commitment: 'confirmed' });
      for (const mint of new Set((tx?.meta?.postTokenBalances ?? []).map((b) => b.mint))) {
        const info = (await conn.getParsedAccountInfo(new PublicKey(mint))).value?.data as any;
        const meta = info?.parsed?.info?.extensions?.find((e: any) => e.extension === 'tokenMetadata')?.state;
        if (meta?.symbol?.toUpperCase() === symbol.toUpperCase()) {
          console.log(`found ${meta.name} (${meta.symbol}): ${mint}`);
          return new PublicKey(mint);
        }
      }
    }
    await new Promise((r) => setTimeout(r, 700));
  }
}

const mint = typeof a.mint === 'string' ? new PublicKey(a.mint) : await watch(new PublicKey(need(a, 'watch')));
const curveTokens = await curveTokensOf(mint);

// The pump.fun accounts can lag the create transaction by a moment at 'confirmed'; retry briefly.
let failures: string[] = [];
for (let attempt = 0; attempt < 20; attempt++) {
  failures = await checkLaunch(rpc, { mint: mint.toBase58(), curveTokenAccount: curveTokens.toBase58() }, PUMP.toBase58(), SALEABLE);
  if (!failures.length) break;
  await new Promise((r) => setTimeout(r, 500));
}
if (failures.length) {
  console.log(`\nNOT launching: ${mint.toBase58()} does not fit the committed rules:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('token checks passed: 6 decimals, 1B fixed supply, no authorities, 793,100,000 on the curve');

const mintRecord = PublicKey.findProgramAddressSync([Buffer.from('mint')], vaultProgram)[0];
const ix = new TransactionInstruction({
  programId: vaultProgram,
  keys: [
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: mintRecord, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.concat([createHash('sha256').update('global:set_mint').digest().subarray(0, 8), curveTokens.toBuffer()]),
});
const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [authority], { commitment: 'confirmed', maxRetries: 10 });
console.log(`\nmint recorded in the vault program: ${sig}`);
console.log(`mint ${mint.toBase58()}\ncurve token account ${curveTokens.toBase58()}`);
console.log('The site goes live within seconds. Later (no rush): put the mint in indexer/config.mainnet.json too.');
