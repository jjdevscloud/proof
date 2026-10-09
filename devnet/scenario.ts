// Step 4: exercise every SPEC §6 rule on devnet. Resumable: finished steps are recorded in state.json.
// Amounts are in whole tokens; positions in verify.ts follow from these numbers.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import {
  AuthorityType, createAccount, getOrCreateAssociatedTokenAccount, setAuthority, transferChecked,
} from '@solana/spl-token';
import {
  DECIMALS, REPO, T, buyEnvelopeIx, connection, curveBuyIx, curveSellIx, envelopePdas, giftIx, key, listIx, loadState,
  memoIx, migrateIx, nextEnvelopeId, saveState, sealIx, send, withdrawIx,
} from './lib.ts';
import { INDEXER_URL, RULES_PATH, REVEAL_PATH } from './lib.ts';
import { parseReveal } from '../indexer/src/reveal.ts';
import { deriveTraits, parseRules } from '../indexer/src/derive.ts';

const state = loadState();
state.steps ??= {};
const mint = key('mint').publicKey;
const [payer, alice, bob, carol, dave, erin, pool] = (['payer', 'alice', 'bob', 'carol', 'dave', 'erin', 'pool'] as const).map(key);

async function step(name: string, fn: () => Promise<string | void>) {
  if (state.steps[name]) return console.log(`  ${name.padEnd(44)} (done)`);
  const sig = (await fn()) ?? 'ok';
  state.steps[name] = sig;
  saveState(state);
}

const ata = async (owner: Keypair) => (await getOrCreateAssociatedTokenAccount(connection, payer, mint, owner.publicKey)).address;
const A = await ata(alice);
const B = await ata(bob);
const C = await ata(carol);
const P = await ata(pool);
const tokens = (n: number) => BigInt(n) * T;
const sendTokens = (from: Keypair, src: PublicKey, dst: PublicKey, n: number) =>
  transferChecked(connection, from, src, mint, dst, from, tokens(n), DECIMALS);

await step('01 alice buys 3,000,000', () => send([curveBuyIx(alice.publicKey, mint, A, tokens(3_000_000))], [alice], 'alice buy'));
await step('02 bob buys 1,500,000', () => send([curveBuyIx(bob.publicKey, mint, B, tokens(1_500_000))], [bob], 'bob buy'));
await step('03 alice sends 500,000 to pool', () => sendTokens(alice, A, P, 500_000));
await step('04 bob sells 500,000 back to curve', () => send([curveSellIx(bob.publicKey, mint, B, tokens(500_000))], [bob], 'bob sell-back'));
await step('05 carol buys 1,000,000', () => send([curveBuyIx(carol.publicKey, mint, C, tokens(1_000_000))], [carol], 'carol buy'));

const daveAccount = key('daveAccount');
await step('06a dave creates non-ATA account', async () => (await createAccount(connection, payer, mint, dave.publicKey, daveAccount)).toBase58());
await step('06b dave buys 1,000,000', () => send([curveBuyIx(dave.publicKey, mint, daveAccount.publicKey, tokens(1_000_000))], [dave], 'dave buy'));
await step('07 dave hands account to erin', () =>
  setAuthority(connection, dave, daveAccount.publicKey, dave, AuthorityType.AccountOwner, erin.publicKey));

// Envelope 1: valid seal of strike 0, sold, gifted, withdrawn.
state.e1 ??= (await nextEnvelopeId()).toString();
const e1 = envelopePdas(BigInt(state.e1));
await step('08 alice seals strike 0', () =>
  send([sealIx(alice.publicKey, BigInt(state.e1), A, mint, [{ start: 0n, len: tokens(1_000_000) }])], [alice], 'seal E1'));
const price = BigInt(0.01 * LAMPORTS_PER_SOL);
await step('09 alice lists E1', () => send([listIx(alice.publicKey, e1.envelope, price)], [alice], 'list E1'));
await step('10 carol buys E1', () => send([buyEnvelopeIx(carol.publicKey, alice.publicKey, e1.envelope, price)], [carol], 'buy E1'));
await step('11 carol gifts E1 to bob', () => send([giftIx(carol.publicKey, e1.envelope, bob.publicKey)], [carol], 'gift E1'));
await step('12 bob withdraws E1', () => send([withdrawIx(bob.publicKey, e1.envelope, e1.vault, B, mint)], [bob], 'withdraw E1'));

// Envelope 2: names a range alice does not hold -> invalid, melts alice's top 10 tokens.
state.e2 ??= (await nextEnvelopeId()).toString();
await step('13 alice seals a range she does not hold', () =>
  send([sealIx(alice.publicKey, BigInt(state.e2), A, mint, [{ start: tokens(3_000_000), len: tokens(10) }])], [alice], 'seal E2 (invalid)'));

await step('14 migrate 1,000,000 curve -> pool', () => send([migrateIx(payer.publicKey, mint, P, tokens(1_000_000))], [payer], 'migrate'));

// Reveal: wait until the indexer has passed the seed point, then derive the traits from the first
// block at or after it (what ops/make-reveal.ts does on mainnet) and post the reveal memo.
await step('15 reveal from the public seed block', async () => {
  // EXTERNAL_REVEAL=1: someone else runs ops/make-reveal.ts --post; wait until the indexer has it.
  if (process.env.EXTERNAL_REVEAL) {
    console.log('  waiting for an external reveal (ops/make-reveal.ts --post) ...');
    while (!(await (await fetch(`${INDEXER_URL}/reveal`)).json()).revealed) await new Promise((r) => setTimeout(r, 2000));
    return 'external';
  }
  let status: any;
  for (let i = 0; ; i++) {
    status = await (await fetch(`${INDEXER_URL}/reveal`)).json();
    if (status.seedFixed) break;
    if (i % 10 === 0) console.log(`  waiting for the seed point (slot ${status.seedTargetSlot}) ...`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  const rulesText = readFileSync(RULES_PATH, 'utf8');
  const seedSlot = (await connection.getBlocks(status.seedTargetSlot, status.seedTargetSlot + 500, 'finalized'))[0];
  const block = await connection.getBlock(seedSlot, { transactionDetails: 'none', rewards: false, maxSupportedTransactionVersion: 1, commitment: 'finalized' });
  const data = {
    version: 1, rules: rulesText, seedTargetSlot: status.seedTargetSlot, seedSlot, blockhash: block!.blockhash,
    eligibleStrikes: status.eligibleStrikes, strikes: deriveTraits(parseRules(rulesText), block!.blockhash, status.eligibleStrikes),
  };
  const bytes = Buffer.from(JSON.stringify(data));
  const { fileHash } = parseReveal(bytes);
  writeFileSync(REVEAL_PATH, bytes);
  console.log(`  seed block ${seedSlot}; ${status.eligibleStrikes} eligible Strikes; reveal file written`);
  await new Promise((r) => setTimeout(r, 8000)); // let the indexer pick up the file before the memo lands
  return send([memoIx(`proof:v1:reveal:${fileHash}`, key('reveal').publicKey)], [key('reveal')], 'reveal memo');
});

await step('16 alice sends 600,000 to pool after reveal', () => sendTokens(alice, A, P, 600_000));

const last = state.steps['16 alice sends 600,000 to pool after reveal'];
const status = await connection.getSignatureStatus(last, { searchTransactionHistory: true });
state.lastSlot = status.value?.slot;
state.accounts = { A: A.toBase58(), B: B.toBase58(), C: C.toBase58(), P: P.toBase58(), D: daveAccount.publicKey.toBase58() };
state.envelopes = { E1: e1.envelope.toBase58(), E2: envelopePdas(BigInt(state.e2)).envelope.toBase58() };
saveState(state);
console.log(`\nscenario complete; last tx in slot ${state.lastSlot}`);
