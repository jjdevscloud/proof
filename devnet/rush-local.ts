// Launch-rush stress test on a local validator (after setup.ts, indexers running): many wallets buy
// off the curve at once, then a quarter send tokens with transferChecked (names the mint), a quarter
// with a plain transfer (does not name the mint), a quarter sell back. Every wallet's rare amount is
// then checked against the rules, and how long the indexer takes to catch up is measured.
// Usage: RPC_URL=http://127.0.0.1:8899 node rush-local.ts [wallets=200]
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, createTransferInstruction, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { DECIMALS, INDEXER_URL, T, connection, curveBuyIx, curveSellIx, key } from './lib.ts';

const N = Number(process.argv[2] ?? 200);
const CONCURRENCY = 24;
const mint = key('mint').publicKey;
const payer = key('payer');
const wallets = Array.from({ length: N }, () => Keypair.generate());
const sink = Keypair.generate().publicKey;
const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner);

async function pool<T>(items: T[], fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}
async function send(tx: Transaction, signers: Keypair[]) {
  for (let attempt = 0; ; attempt++) {
    try {
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = signers[0].publicKey;
      tx.signatures = [];
      tx.sign(...signers);
      const sig = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(sig, 'confirmed');
      const st = (await connection.getSignatureStatuses([sig])).value[0];
      if (st?.err) throw new Error(JSON.stringify(st.err));
      return sig;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

// Fund all wallets in a few large transfers.
for (let i = 0; i < N; i += 20) {
  const tx = new Transaction();
  for (const w of wallets.slice(i, i + 20)) tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: w.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }));
  await send(tx, [payer]);
}
console.log(`  funded ${N} wallets`);

// The rush: everyone buys a random amount at once.
const bought = wallets.map(() => BigInt(200_000 + Math.floor(Math.random() * 800_000)) * T);
let t0 = Date.now();
await pool(wallets, async (w, i) => {
  await send(new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(w.publicKey, ata(w.publicKey), w.publicKey, mint),
    curveBuyIx(w.publicKey, mint, ata(w.publicKey), bought[i]),
  ), [w]);
});
console.log(`  ${N} curve buys in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// Then everyone acts at once. Outflows leave ordinary tokens first; these accounts have none,
// so every token sent or sold melts rare positions.
const out = wallets.map(() => 0n);
const kinds = ['checked', 'plain', 'sell', 'hold'] as const;
t0 = Date.now();
await pool(wallets, async (w, i) => {
  const kind = kinds[i % 4];
  if (kind === 'hold') return;
  const amount = (bought[i] * BigInt(20 + (i % 50))) / 100n;
  const tx = new Transaction();
  if (kind === 'checked') {
    tx.add(createAssociatedTokenAccountIdempotentInstruction(w.publicKey, ata(sink), sink, mint));
    tx.add(createTransferCheckedInstruction(ata(w.publicKey), mint, ata(sink), w.publicKey, amount, DECIMALS));
  } else if (kind === 'plain') {
    tx.add(createAssociatedTokenAccountIdempotentInstruction(w.publicKey, ata(sink), sink, mint));
    tx.add(createTransferInstruction(ata(w.publicKey), ata(sink), w.publicKey, amount)); // no mint key
  } else {
    tx.add(curveSellIx(w.publicKey, mint, ata(w.publicKey), amount));
  }
  await send(tx, [w]);
  out[i] = amount;
});
const lastTxAt = Date.now();
console.log(`  ${(N * 3) / 4} transfers / sells in ${((lastTxAt - t0) / 1000).toFixed(1)} s`);

// Wait for both indexers to pass the chain tip as of now.
const tip = await connection.getSlot('confirmed');
const health = async (u: string) => (await fetch(`${u}/health`)).json() as Promise<any>;
const apis = [INDEXER_URL, INDEXER_URL.replace('8787', '8788')];
for (const u of apis) {
  while ((await health(u)).syncedSlot < tip) await new Promise((r) => setTimeout(r, 500));
}
console.log(`  both indexers caught up ${((Date.now() - lastTxAt) / 1000).toFixed(1)} s after the last transaction (finalization alone is ~13 s on mainnet)`);

let failures = 0;
const prints = await Promise.all(apis.map(async (u) => (await health(u)).fingerprint));
if (prints[0] !== prints[1]) {
  failures++;
  console.log(`  FAIL indexers disagree: ${prints.join(' vs ')}`);
} else console.log('  PASS both indexers agree on the fingerprint');

let wrong = 0;
await pool(wallets, async (w, i) => {
  const view = await (await fetch(`${INDEXER_URL}/wallet/${w.publicKey.toBase58()}`)).json() as any;
  const rare = (view.accounts ?? []).flatMap((a: any) => a.segments).reduce((t: bigint, s: any) => t + BigInt(s.end) - BigInt(s.start), 0n);
  const expected = bought[i] - out[i];
  if (rare !== expected) {
    wrong++;
    if (wrong <= 5) console.log(`  FAIL wallet ${i} (${kinds[i % 4]}): ledger ${rare}, rules ${expected}`);
  }
});
if (wrong) failures++;
console.log(`  ${wrong ? 'FAIL' : 'PASS'} every wallet's rare amount matches the rules (${N - wrong}/${N})`);

const stats = await (await fetch(`${INDEXER_URL}/stats`)).json() as any;
const ok = BigInt(stats.surviving) + BigInt(stats.melted) === BigInt(stats.issued);
if (!ok) failures++;
console.log(`  ${ok ? 'PASS' : 'FAIL'} surviving + melted = issued`);
console.log(failures ? `\n${failures} check(s) FAILED` : '\nrush test passed');
process.exit(failures ? 1 : 0);
