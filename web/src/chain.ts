// Wallet connection, proof_vault transactions, and the on-chain buyer checks (SPEC §9.1).
import {
  Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync, unpackAccount,
} from '@solana/spl-token';
import { useSyncExternalStore } from 'react';
import type { Config } from './api.ts';
import { DEMO, DEMO_WALLET } from './demo.ts';

// Production builds use '/rpc': the site's own server forwards a restricted set of methods, so the
// RPC provider's key is never exposed to browsers.
const configuredRpc = import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com';
export const RPC_URL = configuredRpc.startsWith('/') ? `${location.origin}${configuredRpc}` : configuredRpc;
export const connection = new Connection(RPC_URL, 'confirmed');

// Polls for confirmation instead of a websocket subscription (the /rpc proxy is HTTP only).
async function confirm(signature: string, lastValidBlockHeight: number): Promise<void> {
  for (;;) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const st = value[0];
    if (st?.err) throw new Error(`Transaction failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return;
    if ((await connection.getBlockHeight('confirmed')) > lastValidBlockHeight) throw new Error('Transaction expired before confirming; please try again');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ---- wallet (injected providers: Phantom, Solflare, Backpack) ----

type Provider = {
  publicKey: PublicKey | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey } | void>;
  disconnect: () => Promise<void>;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  on?: (event: string, cb: (...args: any[]) => void) => void;
};

// Demo mode: a pretend wallet that always connects as DEMO_WALLET.
const demoProvider: Provider = {
  publicKey: null,
  connect: async () => ({ publicKey: new PublicKey(DEMO_WALLET) }),
  disconnect: async () => {},
  signTransaction: async (tx) => tx,
};

function provider(): Provider | null {
  if (DEMO) return demoProvider;
  const w = window as any;
  return w.phantom?.solana ?? w.solflare ?? w.backpack ?? w.solana ?? null;
}

// Remembered across reloads so the site can reconnect silently. Only the user's explicit
// Disconnect clears it.
const REMEMBER_KEY = 'proof:wallet-connected';
function remember(on: boolean) {
  try {
    if (on) localStorage.setItem(REMEMBER_KEY, '1');
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {}
}
function remembered(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) === '1';
  } catch {
    return false;
  }
}

let connected: string | null = null;
let restoring = remembered();
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
const setConnected = (pk: PublicKey | null | undefined) => {
  connected = pk?.toBase58() ?? null;
  emit();
};

// Wallet events are wired once per provider, not on every connect.
let wired: Provider | null = null;
function wire(p: Provider) {
  if (wired === p) return;
  wired = p;
  p.on?.('connect', (pk?: PublicKey) => setConnected(pk ?? p.publicKey));
  p.on?.('disconnect', () => setConnected(null));
  p.on?.('accountChanged', (pk: PublicKey | null) => {
    if (pk) return setConnected(pk);
    // Phantom reports null when it locks or switches to an account this site hasn't seen yet.
    // Try a silent reconnect before treating it as disconnected.
    p.connect({ onlyIfTrusted: true }).then((r) => setConnected(r?.publicKey ?? p.publicKey)).catch(() => setConnected(null));
  });
}

// Silent reconnect on page load: never opens a popup, only succeeds if the user approved this site before.
async function restore() {
  if (!restoring) return;
  // Extensions can inject their provider shortly after the page starts.
  for (let i = 0; i < 20 && !provider(); i++) await new Promise((r) => setTimeout(r, 100));
  const p = provider();
  if (p) {
    wire(p);
    try {
      const res = await p.connect({ onlyIfTrusted: true });
      setConnected(res?.publicKey ?? p.publicKey);
    } catch {
      // Not trusted any more (revoked in the wallet): stay disconnected until the user clicks Connect.
    }
  }
  restoring = false;
  emit();
}
if (typeof window !== 'undefined') restore();

export function useWallet(): {
  address: string | null;
  restoring: boolean;
  available: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
} {
  const snapshot = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => `${connected ?? ''}|${restoring}`,
  );
  const [address, isRestoring] = snapshot.split('|');
  return {
    address: address || null,
    restoring: isRestoring === 'true',
    available: !!provider(),
    connect: async () => {
      const p = provider();
      if (!p) throw new Error('No Solana wallet found. Install Phantom or Solflare.');
      wire(p);
      const res = await p.connect();
      setConnected(res?.publicKey ?? p.publicKey);
      remember(true);
    },
    disconnect: async () => {
      remember(false);
      await provider()?.disconnect();
      setConnected(null);
    },
  };
}

// How a Vault submits instructions: the connected wallet by default, or a simulation in tests.
export type Sender = (feePayer: string, ixs: TransactionInstruction[]) => Promise<string>;

export const walletSender: Sender = (feePayer, ixs) => {
  if (DEMO) return new Promise((r) => setTimeout(() => r(`demo${Date.now()}`), 900));
  if (feePayer !== connected) throw new Error('Connected wallet does not match this action');
  return signAndSend(ixs);
};

// Runs the transaction against current chain state without signatures. Throws on failure.
export function simulateAs(): Sender {
  return async (feePayer, ixs) => {
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({ payerKey: new PublicKey(feePayer), recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
    const res = await connection.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true });
    if (res.value.err) throw new Error(`simulation failed: ${JSON.stringify(res.value.err)} ${(res.value.logs ?? []).slice(-3).join(' | ')}`);
    return 'simulated';
  };
}

export async function signAndSend(ixs: TransactionInstruction[]): Promise<string> {
  const p = provider();
  if (!p || !connected) throw new Error('Connect a wallet first');
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: new PublicKey(connected), blockhash, lastValidBlockHeight }).add(...ixs);
  const signed = await p.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  await confirm(sig, lastValidBlockHeight);
  return sig;
}

// ---- encoding ----

async function disc(name: string): Promise<Uint8Array> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`global:${name}`));
  return new Uint8Array(h).slice(0, 8);
}
function u64(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
function concat(...parts: Uint8Array[]): Buffer {
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}
const w = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });

// ---- proof_vault ----

export class Vault {
  readonly programId: PublicKey;
  readonly mint: PublicKey;
  readonly config: Config;
  private send: Sender;
  constructor(config: Config, send: Sender = walletSender) {
    this.config = config;
    this.send = send;
    this.programId = new PublicKey(config.vaultProgramId);
    this.mint = new PublicKey(config.mint);
  }

  configPda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('config')], this.programId)[0];
  }
  envelopePda(id: bigint): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('envelope'), Buffer.from(u64(id))], this.programId)[0];
  }
  vaultPda(envelope: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('vault'), envelope.toBuffer()], this.programId)[0];
  }

  async tokenProgram(): Promise<PublicKey> {
    const info = await connection.getAccountInfo(this.mint);
    if (!info) throw new Error('Mint not found');
    return info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  }

  async seal(holder: string, source: string, ranges: { start: bigint; end: bigint }[]): Promise<string> {
    if (ranges.length < 1 || ranges.length > 8) throw new Error('An envelope holds 1 to 8 ranges');
    if (DEMO) return this.send(holder, []); // demo: no chain reads
    const info = await connection.getAccountInfo(this.configPda());
    if (!info) throw new Error('Vault program is not initialized');
    const id = info.data.readBigUInt64LE(8);
    const envelope = this.envelopePda(id);
    const tokenProgram = await this.tokenProgram();
    const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : 1));
    const data = concat(await disc('seal'), u32(sorted.length), ...sorted.flatMap((x) => [u64(x.start), u64(x.end - x.start)]));
    return this.send(holder, [new TransactionInstruction({
      programId: this.programId,
      keys: [
        w(new PublicKey(holder), true), w(this.configPda()), w(envelope), w(this.vaultPda(envelope)),
        w(new PublicKey(source)), r(this.mint), r(tokenProgram), r(SystemProgram.programId),
      ],
      data,
    })]);
  }

  async list(holder: string, envelope: string, lamports: bigint): Promise<string> {
    return this.send(holder, [new TransactionInstruction({
      programId: this.programId, keys: [r(new PublicKey(holder), true), w(new PublicKey(envelope))], data: concat(await disc('list'), u64(lamports)),
    })]);
  }

  async cancel(holder: string, envelope: string): Promise<string> {
    return this.send(holder, [new TransactionInstruction({
      programId: this.programId, keys: [r(new PublicKey(holder), true), w(new PublicKey(envelope))], data: concat(await disc('cancel')),
    })]);
  }

  async gift(holder: string, envelope: string, to: string): Promise<string> {
    const recipient = new PublicKey(to);
    return this.send(holder, [new TransactionInstruction({
      programId: this.programId, keys: [r(new PublicKey(holder), true), w(new PublicKey(envelope))], data: concat(await disc('gift'), recipient.toBytes()),
    })]);
  }

  async buy(buyer: string, holder: string, envelope: string, maxLamports: bigint): Promise<string> {
    return this.send(buyer, [new TransactionInstruction({
      programId: this.programId,
      keys: [
        w(new PublicKey(buyer), true), w(new PublicKey(holder)), w(new PublicKey(envelope)), r(SystemProgram.programId),
        w(new PublicKey(this.config.treasury)),
      ],
      data: concat(await disc('buy'), u64(maxLamports)),
    })]);
  }

  // Sends everything to the holder's associated token account (created if needed). Melts.
  async withdraw(holder: string, envelope: string, vault: string): Promise<string> {
    if (DEMO) return this.send(holder, []);
    const owner = new PublicKey(holder);
    const tokenProgram = await this.tokenProgram();
    const destination = getAssociatedTokenAddressSync(this.mint, owner, false, tokenProgram);
    return this.send(holder, [
      createAssociatedTokenAccountIdempotentInstruction(owner, destination, owner, this.mint, tokenProgram),
      new TransactionInstruction({
        programId: this.programId,
        keys: [w(owner, true), w(new PublicKey(envelope)), w(new PublicKey(vault)), w(destination), r(this.mint), r(tokenProgram)],
        data: concat(await disc('withdraw')),
      }),
    ]);
  }

  // DEVNET ONLY: buy fresh tokens off the mock curve (programs/mock-curve) into the wallet's
  // associated token account, so testers get rare positions without pump.fun.
  async devnetCurveBuy(buyer: string, tokens: bigint): Promise<string> {
    if (import.meta.env.VITE_CLUSTER === 'mainnet-beta') throw new Error('Test tokens are devnet-only');
    if (DEMO) return this.send(buyer, []);
    const owner = new PublicKey(buyer);
    const curveProgram = new PublicKey(this.config.curveProgramId);
    const curve = PublicKey.findProgramAddressSync([Buffer.from('curve'), this.mint.toBuffer()], curveProgram)[0];
    const tokenProgram = await this.tokenProgram();
    const destination = getAssociatedTokenAddressSync(this.mint, owner, false, tokenProgram);
    return this.send(buyer, [
      createAssociatedTokenAccountIdempotentInstruction(owner, destination, owner, this.mint, tokenProgram),
      new TransactionInstruction({
        programId: curveProgram,
        keys: [
          r(owner, true), r(this.mint), r(curve), w(new PublicKey(this.config.curveTokenAccount)), w(destination), r(tokenProgram),
        ],
        data: concat(await disc('buy'), u64(tokens * 1_000_000n), u64(0n)),
      }),
    ]);
  }

  // ---- buyer checks (SPEC §9.1), run against the chain from the browser ----

  async checkEnvelope(address: string, expect: { holder: string; price: string; ranges: { start: string; end: string }[] }): Promise<Check[]> {
    const checks: Check[] = [];
    const add = (label: string, ok: boolean, detail = '') => checks.push({ label, ok, detail });
    if (DEMO) {
      for (const l of ['Envelope belongs to the Sequents vault program', "Envelope address is the program's own (no private key exists)", 'Listed for sale', 'Price matches the listing', 'Token is the official $PROOF mint', 'Only the envelope controls the vault', 'No delegate can move the tokens', 'No close authority', 'Not frozen', 'Vault balance covers the sealed amount', 'Ledger confirms the seller really held these tokens']) add(l, true, 'demo');
      return checks;
    }
    const envKey = new PublicKey(address);
    const envInfo = await connection.getAccountInfo(envKey);
    if (!envInfo) {
      add('Envelope exists on-chain', false, 'Not found — it may have been withdrawn');
      return checks;
    }
    add('Envelope belongs to the Sequents vault program', envInfo.owner.equals(this.programId), envInfo.owner.toBase58());
    const env = decodeEnvelope(envInfo.data);
    add('Envelope address is the program\'s own (no private key exists)', this.envelopePda(env.id).equals(envKey), `id ${env.id}`);
    const vaultKey = this.vaultPda(envKey);
    add('Vault is the envelope\'s program-owned token account', vaultKey.equals(env.vault));
    add('Listed for sale', env.status === 'listed', env.status);
    add('Price matches the listing', env.price.toString() === expect.price, `${env.price} lamports`);
    add('Seller matches the listing', env.holder.toBase58() === expect.holder);

    const vaultInfo = await connection.getAccountInfo(vaultKey);
    if (!vaultInfo) {
      add('Vault token account exists', false);
      return checks;
    }
    const genuine = vaultInfo.owner.equals(TOKEN_PROGRAM_ID) || vaultInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
    add('Held by the genuine Solana token program', genuine, vaultInfo.owner.toBase58());
    if (!genuine) return checks;
    const acct = unpackAccount(vaultKey, vaultInfo, vaultInfo.owner);
    add('Token is the official $PROOF mint', acct.mint.equals(this.mint), acct.mint.toBase58());
    add('Only the envelope controls the vault', acct.owner.equals(envKey));
    add('No delegate can move the tokens', acct.delegate === null);
    add('No close authority', acct.closeAuthority === null);
    add('Not frozen', !acct.isFrozen);
    add('Vault balance covers the sealed amount', acct.amount >= env.amount, `${acct.amount} ≥ ${env.amount}`);
    // The ledger merges touching ranges; merge the declared ones the same way before comparing.
    const merged: { start: bigint; end: bigint }[] = [];
    for (const x of env.ranges) {
      const last = merged[merged.length - 1];
      if (last && last.end === x.start) last.end = x.start + x.len;
      else merged.push({ start: x.start, end: x.start + x.len });
    }
    const declared = merged.map((x) => `${x.start}-${x.end}`).join(',');
    const ledger = expect.ranges.map((x) => `${x.start}-${x.end}`).join(',');
    add('Ledger confirms the seller really held these tokens', declared === ledger,
      declared === ledger ? 'Sealed ranges are intact' : 'Invalid seal — the contents are ordinary $PROOF');
    return checks;
  }
}

export type Check = { label: string; ok: boolean; detail: string };

type DecodedEnvelope = {
  id: bigint; holder: PublicKey; vault: PublicKey; amount: bigint; status: 'sealed' | 'listed'; price: bigint;
  ranges: { start: bigint; len: bigint }[];
};

// Layout of proof_vault::Envelope (after the 8-byte Anchor discriminator).
export function decodeEnvelope(data: Uint8Array): DecodedEnvelope {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8;
  const id = v.getBigUint64(o, true); o += 8;
  const holder = new PublicKey(data.slice(o, o + 32)); o += 32;
  const vault = new PublicKey(data.slice(o, o + 32)); o += 32;
  const amount = v.getBigUint64(o, true); o += 8;
  const status = data[o] === 1 ? 'listed' : 'sealed'; o += 1;
  const price = v.getBigUint64(o, true); o += 8;
  const n = v.getUint32(o, true); o += 4;
  const ranges = [];
  for (let i = 0; i < n; i++) {
    ranges.push({ start: v.getBigUint64(o, true), len: v.getBigUint64(o + 8, true) });
    o += 16;
  }
  return { id, holder, vault, amount, status, price, ranges };
}

export function isAddress(s: string): boolean {
  try {
    new PublicKey(s);
    return s.length >= 32;
  } catch {
    return false;
  }
}
