// Shared devnet helpers: keys, connection, instruction builders for proof_vault and mock_curve.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const REPO = join(ROOT, '..');
export const KEYS = join(ROOT, 'keys');
export const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
// Each cluster keeps its own run state, rules and reveal files.
export const CLUSTER = process.env.CLUSTER ?? (/127.0.0.1|localhost/.test(RPC_URL) ? 'localnet' : 'devnet');
export const STATE = join(ROOT, CLUSTER === 'devnet' ? 'state.json' : `state.${CLUSTER}.json`);
export const RULES_PATH = join(ROOT, `rules.${CLUSTER}.json`);
export const REVEAL_PATH = join(ROOT, `reveal.${CLUSTER}.json`);
export const INDEXER_URL = process.env.INDEXER_URL ?? 'http://localhost:8787';
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const DECIMALS = 6;
export const T = 1_000_000n; // base units per token

export const connection = new Connection(RPC_URL, 'confirmed');

export const WALLETS = ['payer', 'mint', 'reveal', 'alice', 'bob', 'carol', 'dave', 'erin', 'pool', 'daveAccount'] as const;
export type WalletName = (typeof WALLETS)[number];

export function key(name: WalletName): Keypair {
  const p = join(KEYS, `${name}.json`);
  if (!existsSync(p)) {
    mkdirSync(KEYS, { recursive: true });
    writeFileSync(p, JSON.stringify([...Keypair.generate().secretKey]));
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
}

export function programId(name: 'proof_vault' | 'mock_curve'): PublicKey {
  const p = join(REPO, 'target', 'deploy', `${name}-keypair.json`);
  if (!existsSync(p)) throw new Error(`${p} missing: run anchor build in WSL first`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8')))).publicKey;
}

export type State = Record<string, any>;
export function loadState(): State {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
}
export function saveState(s: State) {
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

export async function send(ixs: TransactionInstruction[], signers: Keypair[], label: string): Promise<string> {
  const tx = new Transaction().add(...ixs);
  const sig = await sendAndConfirmTransaction(connection, tx, signers, { commitment: 'confirmed' });
  console.log(`  ${label.padEnd(44)} ${sig}`);
  return sig;
}

// ---- encoding ----

export function disc(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
export function u64(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
const w = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });

export function memoIx(text: string, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [r(signer, true)], data: Buffer.from(text, 'utf8') });
}

// ---- mock_curve ----

export function curvePdas(mint: PublicKey) {
  const pid = programId('mock_curve');
  return {
    curve: PublicKey.findProgramAddressSync([Buffer.from('curve'), mint.toBuffer()], pid)[0],
    curveTokens: PublicKey.findProgramAddressSync([Buffer.from('curve_tokens'), mint.toBuffer()], pid)[0],
  };
}

export function initializeCurveIx(payer: PublicKey, mint: PublicKey) {
  const { curve, curveTokens } = curvePdas(mint);
  return new TransactionInstruction({
    programId: programId('mock_curve'),
    keys: [w(payer, true), r(mint), w(curve), w(curveTokens), r(TOKEN_PROGRAM_ID), r(SystemProgram.programId)],
    data: disc('initialize_curve'),
  });
}

function curveMove(name: 'buy' | 'migrate', signer: PublicKey, mint: PublicKey, destination: PublicKey, amount: bigint) {
  const { curve, curveTokens } = curvePdas(mint);
  const args = name === 'buy' ? Buffer.concat([u64(amount), u64(0n)]) : u64(amount);
  return new TransactionInstruction({
    programId: programId('mock_curve'),
    keys: [r(signer, true), r(mint), r(curve), w(curveTokens), w(destination), r(TOKEN_PROGRAM_ID)],
    data: Buffer.concat([disc(name), args]),
  });
}
export const curveBuyIx = (buyer: PublicKey, mint: PublicKey, dest: PublicKey, amount: bigint) => curveMove('buy', buyer, mint, dest, amount);
export const migrateIx = (signer: PublicKey, mint: PublicKey, dest: PublicKey, amount: bigint) => curveMove('migrate', signer, mint, dest, amount);

export function curveSellIx(seller: PublicKey, mint: PublicKey, source: PublicKey, amount: bigint) {
  const { curve, curveTokens } = curvePdas(mint);
  return new TransactionInstruction({
    programId: programId('mock_curve'),
    keys: [r(seller, true), r(mint), r(curve), w(curveTokens), w(source), r(TOKEN_PROGRAM_ID)],
    data: Buffer.concat([disc('sell'), u64(amount), u64(0n)]),
  });
}

// ---- proof_vault ----

export function vaultConfigPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId('proof_vault'))[0];
}

export async function nextEnvelopeId(): Promise<bigint> {
  const info = await connection.getAccountInfo(vaultConfigPda(), 'confirmed');
  if (!info) throw new Error('vault config not initialized');
  return info.data.readBigUInt64LE(8);
}

export function envelopePdas(id: bigint) {
  const pid = programId('proof_vault');
  const envelope = PublicKey.findProgramAddressSync([Buffer.from('envelope'), u64(id)], pid)[0];
  const vault = PublicKey.findProgramAddressSync([Buffer.from('vault'), envelope.toBuffer()], pid)[0];
  return { envelope, vault };
}

export function vaultInitializeIx(payer: PublicKey) {
  return new TransactionInstruction({
    programId: programId('proof_vault'),
    keys: [w(payer, true), w(vaultConfigPda()), r(SystemProgram.programId)],
    data: disc('initialize'),
  });
}

export function sealIx(holder: PublicKey, id: bigint, source: PublicKey, mint: PublicKey, ranges: { start: bigint; len: bigint }[]) {
  const { envelope, vault } = envelopePdas(id);
  return new TransactionInstruction({
    programId: programId('proof_vault'),
    keys: [w(holder, true), w(vaultConfigPda()), w(envelope), w(vault), w(source), r(mint), r(TOKEN_PROGRAM_ID), r(SystemProgram.programId)],
    data: Buffer.concat([disc('seal'), u32(ranges.length), ...ranges.flatMap((x) => [u64(x.start), u64(x.len)])]),
  });
}

export function listIx(holder: PublicKey, envelope: PublicKey, price: bigint) {
  return new TransactionInstruction({ programId: programId('proof_vault'), keys: [r(holder, true), w(envelope)], data: Buffer.concat([disc('list'), u64(price)]) });
}

export function buyEnvelopeIx(buyer: PublicKey, holder: PublicKey, envelope: PublicKey, maxPrice: bigint) {
  return new TransactionInstruction({
    programId: programId('proof_vault'),
    keys: [w(buyer, true), w(holder), w(envelope), r(SystemProgram.programId)],
    data: Buffer.concat([disc('buy'), u64(maxPrice)]),
  });
}

export function giftIx(holder: PublicKey, envelope: PublicKey, to: PublicKey) {
  return new TransactionInstruction({ programId: programId('proof_vault'), keys: [r(holder, true), w(envelope)], data: Buffer.concat([disc('gift'), to.toBuffer()]) });
}

export function withdrawIx(holder: PublicKey, envelope: PublicKey, vault: PublicKey, destination: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    programId: programId('proof_vault'),
    keys: [w(holder, true), w(envelope), w(vault), w(destination), r(mint), r(TOKEN_PROGRAM_ID)],
    data: disc('withdraw'),
  });
}
