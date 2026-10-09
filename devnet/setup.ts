// Step 3 (after the programs are deployed or loaded): test wallets, rules file + commit memo,
// mint, mock curve, vault config, and the indexer configs for this cluster.
// Works on devnet and on a local validator (RPC_URL=http://127.0.0.1:8899).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';
import { AuthorityType, createMint, getMint, mintTo, setAuthority } from '@solana/spl-token';
import {
  CLUSTER, DECIMALS, REPO, ROOT, RPC_URL, RULES_PATH, T, connection, curvePdas, initializeCurveIx, key, loadState, memoIx,
  TREASURY, mintRecordPda, programId, saveState, send, setMintIx, vaultConfigPda, vaultInitializeIx,
} from './lib.ts';
import { sha256 } from '../indexer/src/reveal.ts';

const SALEABLE = 793_100_000n * T;
const TOTAL = 1_000_000_000n * T;
const STRIKE = 1_000_000n * T;

const payer = key('payer');
const reveal = key('reveal');
const state = loadState();

if (CLUSTER === 'localnet' && (await connection.getBalance(payer.publicKey)) < LAMPORTS_PER_SOL) {
  await connection.confirmTransaction(await connection.requestAirdrop(payer.publicKey, 100 * LAMPORTS_PER_SOL), 'confirmed');
}
const bal = await connection.getBalance(payer.publicKey);
console.log(`[${CLUSTER}] payer ${payer.publicKey.toBase58()} has ${bal / LAMPORTS_PER_SOL} SOL`);

// Fund the reveal authority and test wallets (fees + account rent).
for (const name of ['reveal', 'alice', 'bob', 'carol', 'dave', 'erin', 'pool'] as const) {
  const pk = key(name).publicKey;
  if ((await connection.getBalance(pk)) < 0.03 * LAMPORTS_PER_SOL) {
    await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: pk, lamports: 0.05 * LAMPORTS_PER_SOL })], [payer], `fund ${name}`);
  }
}

// The desk-fee treasury must exist (rent-exempt) before small fees can be paid into it.
if ((await connection.getBalance(TREASURY)) === 0) {
  await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: TREASURY, lamports: 0.002 * LAMPORTS_PER_SOL })], [payer], 'fund treasury');
}

// Rules file and commit memo come before the first curve buy (SPEC §4.3). The deadline is short
// for testing (DEADLINE_SLOTS, default 600 ≈ 4 minutes); the scenario's buys happen before it.
if (!state.commitSig) {
  const now = await connection.getSlot('finalized');
  const deadline = now + Number(process.env.DEADLINE_SLOTS ?? 600);
  const text = readFileSync(join(ROOT, 'test-rules.template.json'), 'utf8').replace('"deadlineSlot": 0', `"deadlineSlot": ${deadline}`);
  writeFileSync(RULES_PATH, text);
  state.startSlot = now - 1;
  state.deadlineSlot = deadline;
  state.commitSig = await send([memoIx(`proof:v1:commit:${sha256(text).toString('hex')}:${deadline}`, reveal.publicKey)], [reveal], 'commit memo');
  saveState(state);
}

const mintKp = key('mint');
if (!(await connection.getAccountInfo(mintKp.publicKey))) {
  await createMint(connection, payer, payer.publicKey, null, DECIMALS, mintKp);
  console.log(`  mint created                                  ${mintKp.publicKey.toBase58()}`);
}
const mint = mintKp.publicKey;
const { curve, curveTokens } = curvePdas(mint);

if (!(await connection.getAccountInfo(curve))) {
  await send([initializeCurveIx(payer.publicKey, mint)], [payer], 'initialize mock curve');
}
const mintInfo = await getMint(connection, mint);
if (mintInfo.mintAuthority) {
  await mintTo(connection, payer, mint, curveTokens, payer, TOTAL);
  await setAuthority(connection, payer, mint, payer, AuthorityType.MintTokens, null);
  console.log('  minted 1B to curve, mint authority revoked');
}

if (!(await connection.getAccountInfo(vaultConfigPda()))) {
  await send([vaultInitializeIx(payer.publicKey)], [payer], 'initialize vault config');
}
// Launch step: record the mint (the devnet payer is the launch authority in devnet builds).
if (!(await connection.getAccountInfo(mintRecordPda()))) {
  await send([setMintIx(payer.publicKey, mint, curveTokens)], [payer], 'record the mint in the vault');
}

const indexerConfig = {
  rpcUrl: RPC_URL,
  dataDir: `./data-${CLUSTER}`,
  port: 8787,
  pollMs: 3000,
  maxWindowSlots: 100000,
  startSlot: state.startSlot,
  fingerprintEverySlots: 500,
  mint: mint.toBase58(),
  curveTokenAccount: curveTokens.toBase58(),
  pumpProgramId: programId('mock_curve').toBase58(),
  pumpNonBuyInstructions: ['migrate'],
  vaultProgramId: programId('proof_vault').toBase58(),
  revealAuthority: reveal.publicKey.toBase58(),
  saleableSupply: SALEABLE.toString(),
  strikeSize: STRIKE.toString(),
  revealFile: `../devnet/reveal.${CLUSTER}.json`,
};
writeFileSync(join(REPO, 'indexer', `config.${CLUSTER}.json`), JSON.stringify(indexerConfig, null, 2));
writeFileSync(join(REPO, 'indexer', `config.${CLUSTER}-b.json`), JSON.stringify({ ...indexerConfig, dataDir: `./data-${CLUSTER}-b`, port: 8788 }, null, 2));
console.log(`\nwrote indexer/config.${CLUSTER}.json and config.${CLUSTER}-b.json (second, independent instance)`);
