// Local end-to-end check (not shipped): drives the website's own chain.ts against a local
// validator through the indexer's /rpc proxy, signing with test keys instead of a wallet.
// Run (local validator + indexer on :8787 from devnet/README):
//   VITE_RPC_URL=http://localhost:8787/rpc npx vite build --ssr e2e/site-e2e.ts --outDir dist-e2e && node dist-e2e/site-e2e.js
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { createTransferCheckedInstruction } from '@solana/spl-token';
import type { TransactionInstruction } from '@solana/web3.js';
import { Vault, connection } from '../src/chain.ts';
import type { Config, Envelope, WalletView } from '../src/api.ts';

const API = 'http://localhost:8787';
const key = (n: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`../devnet/keys/${n}.json`, 'utf8'))));
const signers = new Map(['alice', 'bob', 'carol', 'dave'].map((n) => [key(n).publicKey.toBase58(), key(n)]));
const get = async <T>(p: string): Promise<T> => (await fetch(API + p)).json() as Promise<T>;
const sender = async (feePayer: string, ixs: TransactionInstruction[]) => {
  const kp = signers.get(feePayer)!;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(kp);
  const sig = await connection.sendRawTransaction(tx.serialize());
  for (;;) {
    const st = (await connection.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error(`tx failed: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return sig;
    await new Promise((r) => setTimeout(r, 400));
  }
};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};
const until = async <T>(what: string, f: () => Promise<T | null | undefined | false>): Promise<T> => {
  for (let i = 0; i < 120; i++) {
    const v = await f();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out: ${what}`);
};

const local = new Connection('http://127.0.0.1:8899', 'confirmed');
for (const kp of signers.values()) await local.confirmTransaction(await local.requestAirdrop(kp.publicKey, 2e9), 'confirmed');
const config = await get<Config>('/config');
const vault = new Vault(config, sender);
const [alice, bob, carol, dave] = ['alice', 'bob', 'carol', 'dave'].map((n) => key(n).publicKey.toBase58());

// 1. Rare seal from alice's origin account (the wallet page's Seal button).
const aw = await get<WalletView>(`/wallet/${alice}`);
const acct = aw.accounts.find((a) => a.segments.length)!;
const seg = acct.segments[0];
const part = { start: BigInt(seg.start), end: BigInt(seg.start) + 1000n * 1_000_000n };
await vault.seal(alice, acct.account, [part]);
const env1 = await until('sealed envelope indexed', async () =>
  (await get<WalletView>(`/wallet/${alice}`)).envelopes.find((e) => e.ranges.length && BigInt(e.ranges[0].start) === part.start));
check('seal from the wallet page is indexed as a valid rare seal', env1.segments.length === 1);

// 2. List, buyer checks, buy (the desk).
await vault.list(alice, env1.address, 50_000_000n);
const listed = await until('listing indexed', async () => (await get<Envelope>(`/envelope/${env1.address}`)).status === 'listed' && get<Envelope>(`/envelope/${env1.address}`));
const checks = await vault.checkEnvelope(listed.address, { holder: listed.holder, price: listed.price, ranges: listed.ranges });
check('every buyer safety check passes on a genuine rare listing', checks.every((c) => c.ok), checks.filter((c) => !c.ok).map((c) => c.label).join('; '));
const wrongPrice = await vault.checkEnvelope(listed.address, { holder: listed.holder, price: '1', ranges: listed.ranges });
check('a listing whose price differs from the chain fails the checks', wrongPrice.some((c) => !c.ok));
await vault.buy(carol, alice, env1.address, 50_000_000n);
await until('sale indexed', async () => (await get<Envelope>(`/envelope/${env1.address}`)).holder === carol);
check('buy transfers the envelope to the buyer', true);

// 3. Gift, list + cancel, withdraw.
await vault.gift(carol, env1.address, bob);
await until('gift indexed', async () => (await get<Envelope>(`/envelope/${env1.address}`)).holder === bob);
await vault.list(bob, env1.address, 1n);
await until('relist indexed', async () => (await get<Envelope>(`/envelope/${env1.address}`)).status === 'listed');
await vault.cancel(bob, env1.address);
await until('cancel indexed', async () => (await get<Envelope>(`/envelope/${env1.address}`)).status === 'sealed');
await vault.withdraw(bob, env1.address, env1.vault);
await until('withdraw indexed', async () => (await fetch(`${API}/envelope/${env1.address}`)).status === 404);
check('gift, relist, cancel and withdraw all indexed', true);

// 4. Seal & roll from dave's main account (the roll panel), with the lag guard.
let main = await vault.mainTokenAccount(dave);
if (main.balance < 50_000n * 1_000_000n) {
  const aliceMain = await vault.mainTokenAccount(alice);
  await sender(alice, [createTransferCheckedInstruction(new PublicKey(aliceMain.account), vault.mint, new PublicKey(main.account), new PublicKey(alice), 60_000n * 1_000_000n, 6)]);
  await until('dave funded and indexed', async () => {
    const h = await get<{ syncedSlot: number }>('/health');
    return (await vault.lastActivitySlot(main.account)) <= h.syncedSlot;
  });
  main = await vault.mainTokenAccount(dave);
}
const health = await get<{ syncedSlot: number }>('/health');
const last = await vault.lastActivitySlot(main.account);
check('lag guard: account activity slot readable through the /rpc proxy', last > 0 && last <= health.syncedSlot, `last ${last}, synced ${health.syncedSlot}`);
const before = new Set((await get<WalletView>(`/wallet/${dave}`)).envelopes.map((e) => e.address));
const sig = await vault.sealAndRoll(dave, main.account, 50_000n * 1_000_000n);
const shown = await vault.rollOutcome(sig);
const env2 = await until('seal & roll settled', async () =>
  (await get<WalletView>(`/wallet/${dave}`)).envelopes.find((e) => !before.has(e.address) && e.roll?.signature === sig));
check('roll result shown in the browser equals the ledger', shown.name === env2.roll!.name, shown.name);
const after = await vault.lastActivitySlot(main.account);
check('lag guard sees the new transaction', after > last);

// 5. A rolled envelope on the desk: buyer checks (ordinary contents + roll recomputed).
await vault.list(dave, env2.address, 20_000_000n);
const l2 = await until('rolled listing indexed', async () => (await get<Envelope>(`/envelope/${env2.address}`)).status === 'listed' && get<Envelope>(`/envelope/${env2.address}`));
const c2 = await vault.checkEnvelope(l2.address, { holder: l2.holder, price: l2.price, ranges: l2.ranges });
c2.push(await vault.verifyRoll(l2.roll!.signature, l2.roll!.name));
check('every buyer check passes on a rolled listing, roll recomputed', c2.every((c) => c.ok), c2.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`).join('; '));
const forged = await vault.verifyRoll(l2.roll!.signature, l2.roll!.name === 'Hoard' ? 'Coal' : 'Hoard');
check('a forged roll result fails the recomputation', !forged.ok);
await vault.cancel(dave, env2.address);
await until('cancel indexed', async () => (await get<Envelope>(`/envelope/${env2.address}`)).status === 'sealed');

// 6. Roll again (only if Coal).
if (env2.roll!.points === 0) {
  const s2 = await vault.roll(dave, env2.address);
  const r2 = await vault.rollOutcome(s2);
  const e = await until('second roll settled', async () => {
    const x = await get<Envelope>(`/envelope/${env2.address}`);
    return x.roll?.signature === s2 && x;
  });
  check('roll again: browser result equals the ledger', r2.name === e.roll!.name, r2.name);
}

console.log(failures ? `\n${failures} FAILED` : '\nall website transaction checks passed');
process.exit(failures ? 1 : 0);
