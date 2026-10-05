// Launch step 2 (right after the token is created on pump.fun): verify the token matches the
// committed rules and write the mainnet indexer config.
//
//   node check-mint.ts --mint <mint> --rules ../rules/sequents-v1.json --start-slot <from make-commit> \
//     --vault-program <program id> --reveal-authority <address> --rpc <url>
import { readFileSync, writeFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import { parseRules } from '../indexer/src/derive.ts';
import { args, connection, need } from './common.ts';

const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const T = 1_000_000n;

const a = args();
const conn = connection(a);
const mint = new PublicKey(need(a, 'mint'));
const rules = parseRules(readFileSync(need(a, 'rules'), 'utf8'));
let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`);
};

const mintInfo = await conn.getParsedAccountInfo(mint);
const owner = mintInfo.value?.owner;
const parsed = (mintInfo.value?.data as any)?.parsed?.info;
check(!!parsed, 'mint exists');
const tokenProgram = owner?.equals(TOKEN_2022) ? TOKEN_2022 : TOKEN;
check(!!owner && (owner.equals(TOKEN) || owner.equals(TOKEN_2022)), `token program: ${owner?.equals(TOKEN_2022) ? 'Token-2022' : 'SPL Token'}`);
check(parsed?.decimals === 6, `decimals 6 (got ${parsed?.decimals})`);
check(parsed?.supply === (1_000_000_000n * T).toString(), `total supply 1,000,000,000 (got ${Number(BigInt(parsed?.supply ?? 0) / T).toLocaleString()})`);
check(parsed?.mintAuthority === null, 'mint authority revoked');
check(parsed?.freezeAuthority === null, 'freeze authority revoked');
const exts: string[] = (parsed?.extensions ?? []).map((e: any) => e.extension);
const allowed = new Set(['metadataPointer', 'tokenMetadata']);
check(exts.every((e) => allowed.has(e)), `no risky extensions (has: ${exts.join(', ') || 'none'}) — SPEC §9.2`);

// pump.fun bonding curve: PDA ["bonding-curve", mint]; its token account is the ATA of that PDA.
const bondingCurve = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], PUMP)[0];
const curveTokens = PublicKey.findProgramAddressSync([bondingCurve.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
const bc = await conn.getAccountInfo(bondingCurve);
check(!!bc && bc.owner.equals(PUMP), 'pump.fun bonding curve found');
if (bc) {
  // Layout: discriminator 8 | virtual token u64 | virtual sol u64 | real token u64 | real sol u64 | total supply u64 | complete bool
  const realTokens = bc.data.readBigUInt64LE(24);
  const totalSupply = bc.data.readBigUInt64LE(40);
  const curveBalance = BigInt((await conn.getTokenAccountBalance(curveTokens)).value.amount);
  // Everything in the curve account beyond the remaining saleable tokens is the non-saleable remainder.
  const saleable = 1_000_000_000n * T - (curveBalance - realTokens);
  const expected = BigInt(rules.strikeSize) * BigInt(rules.strikeCount - 1) + 100_000n * T;
  check(totalSupply === 1_000_000_000n * T, 'curve total supply 1,000,000,000');
  check(saleable === 793_100_000n * T && saleable === expected, `saleable on the curve: ${Number(saleable / T).toLocaleString()} (rules expect ${Number(expected / T).toLocaleString()} → ${rules.strikeCount} Strikes)`);
}

if (failures) {
  console.log(`\n${failures} check(s) failed — do not proceed; the committed rules do not fit this token.`);
  process.exit(1);
}

const config = {
  rpcUrl: 'set via RPC_URL',
  dataDir: '/data',
  port: 8787,
  pollMs: 2000,
  maxWindowSlots: 20000,
  startSlot: Number(need(a, 'start-slot')),
  fingerprintEverySlots: 9000,
  mint: mint.toBase58(),
  curveTokenAccount: curveTokens.toBase58(),
  pumpProgramId: PUMP.toBase58(),
  pumpNonBuyInstructions: ['migrate', 'withdraw'],
  vaultProgramId: need(a, 'vault-program'),
  revealAuthority: need(a, 'reveal-authority'),
  saleableSupply: (793_100_000n * T).toString(),
  strikeSize: rules.strikeSize,
  revealFile: '/data/reveal.json',
};
writeFileSync('../indexer/config.mainnet.json', JSON.stringify(config, null, 2) + '\n');
console.log(`\nall checks passed; wrote indexer/config.mainnet.json (curve token account ${curveTokens.toBase58()})`);
