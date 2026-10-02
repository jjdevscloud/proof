// Step 3 (after anchor deploy): mint, mock curve, reveal file + commit memo, vault config,
// and the indexer's devnet config.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';
import { AuthorityType, createMint, getMint, mintTo, setAuthority } from '@solana/spl-token';
import {
  DECIMALS, REPO, RPC_URL, T, connection, curvePdas, initializeCurveIx, key, loadState, memoIx, programId, saveState, send,
  vaultConfigPda, vaultInitializeIx,
} from './lib.ts';
import { leafHash, merkleRoot, sha256 } from '../indexer/src/reveal.ts';

const SALEABLE = 793_100_000n * T;
const TOTAL = 1_000_000_000n * T;
const STRIKE = 1_000_000n * T;
const STRIKES = Number((SALEABLE + STRIKE - 1n) / STRIKE);

// Fixed test traits so verify.ts can predict outflow order: strikes 0–9 Genesis,
// Double Die on 1, 400, 700. Higher rank = rarer.
export function testReveal() {
  const doubleDie = new Set([1, 400, 700]);
  return {
    version: 1 as const,
    strikes: Array.from({ length: STRIKES }, (_, i) => {
      const traits = [...(i < 10 ? ['Genesis'] : ['Common Date']), ...(doubleDie.has(i) ? ['Double Die'] : [])];
      const rank = (i < 10 ? 2 : 0) + (doubleDie.has(i) ? 5 : 0);
      return { strike: i, rank, traits, salt: randomBytes(32).toString('hex') };
    }),
  };
}

const payer = key('payer');
const reveal = key('reveal');
const state = loadState();

const bal = await connection.getBalance(payer.publicKey);
console.log(`payer ${payer.publicKey.toBase58()} has ${bal / LAMPORTS_PER_SOL} SOL`);

// Fund the reveal authority and test wallets (fees + account rent).
for (const name of ['reveal', 'alice', 'bob', 'carol', 'dave', 'erin', 'pool'] as const) {
  const pk = key(name).publicKey;
  if ((await connection.getBalance(pk)) < 0.03 * LAMPORTS_PER_SOL) {
    await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: pk, lamports: 0.05 * LAMPORTS_PER_SOL })], [payer], `fund ${name}`);
  }
}

// Reveal file and commit memo come before the first curve buy (SPEC §4.3).
if (!state.commitSig) {
  const data = testReveal();
  const bytes = Buffer.from(JSON.stringify(data, null, 1));
  const revealPath = join(REPO, 'devnet', 'reveal.json');
  writeFileSync(revealPath, bytes);
  const root = merkleRoot(data.strikes.map(leafHash)).toString('hex');
  state.revealFileHash = sha256(bytes).toString('hex');
  state.startSlot = (await connection.getSlot('finalized')) - 1;
  state.commitSig = await send([memoIx(`proof:v1:commit:${root}`, reveal.publicKey)], [reveal], 'commit memo');
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

const indexerConfig = {
  rpcUrl: RPC_URL,
  dataDir: './data-devnet',
  port: 8787,
  pollMs: 3000,
  maxWindowSlots: 2000,
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
  revealFile: '../devnet/reveal.json',
};
writeFileSync(join(REPO, 'indexer', 'config.devnet.json'), JSON.stringify(indexerConfig, null, 2));
writeFileSync(join(REPO, 'indexer', 'config.devnet-b.json'), JSON.stringify({ ...indexerConfig, dataDir: './data-devnet-b', port: 8788 }, null, 2));
console.log('\nwrote indexer/config.devnet.json and config.devnet-b.json (second, independent instance)');
