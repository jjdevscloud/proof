// Misuse and attack cases against the deployed proof_vault (SPEC §7 invariants).
// Each case is ONE simulated transaction: legitimate setup instructions followed by the attack.
// The setup alone must succeed, and the full transaction must fail AT the attack instruction with
// the expected error. Simulation changes no devnet state, so verify.ts stays valid.
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  MINT_SIZE, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createInitializeMint2Instruction,
  createMintToInstruction, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  T, buyEnvelopeIx, connection, envelopePdas, giftIx, key, listIx, nextEnvelopeId, sealIx, setMintIx, withdrawIx,
} from './lib.ts';

// proof_vault error codes (Anchor custom errors start at 6000, in VaultError order).
const E = {
  WrongMint: 6000, WrongHolder: 6001, WrongVault: 6002, WrongStatus: 6003, ZeroPrice: 6004, PriceChanged: 6005,
  SelfPurchase: 6006, BadRangeCount: 6007, EmptyRange: 6008, UnsortedRanges: 6009, WrongTreasury: 6012,
  NotLaunchAuthority: 6013,
  ConstraintTokenMint: 2014, // Anchor built-in: token account has the wrong mint
} as const;

const [payer, alice, bob, carol] = (['payer', 'alice', 'bob', 'carol'] as const).map(key);
const mint = key('mint').publicKey;
const ata = (owner: PublicKey, m = mint) => getAssociatedTokenAddressSync(m, owner);
const A = ata(alice.publicKey);
const id = await nextEnvelopeId();
const { envelope, vault } = envelopePdas(id);
const price = BigInt(0.01 * LAMPORTS_PER_SOL);

// Alice seals one token of her surviving Strike #1 range: the shared setup for most cases.
const seal = sealIx(alice.publicKey, id, A, mint, [{ start: 1_000_000n * T, len: T }]);
const list = listIx(alice.publicKey, envelope, price);

type Case = { name: string; setup: TransactionInstruction[]; attack: TransactionInstruction[]; signers: Keypair[]; expect: number | 'any' };

async function fakeMintSetup(owner: Keypair) {
  const fake = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const fakeAta = ata(owner.publicKey, fake.publicKey);
  return {
    fake,
    fakeAta,
    ixs: [
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: fake.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(fake.publicKey, 6, owner.publicKey, null),
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, fakeAta, owner.publicKey, fake.publicKey),
      createMintToInstruction(fake.publicKey, fakeAta, owner.publicKey, 1_000n * T),
    ],
  };
}

const fakeForSeal = await fakeMintSetup(alice);
const fakeForWithdraw = await fakeMintSetup(alice);
const range = (start: bigint, len: bigint) => ({ start, len });

const cases: Case[] = [
  {
    name: 'someone other than the launch authority records a mint',
    setup: [],
    attack: [setMintIx(alice.publicKey, mint, alice.publicKey)],
    signers: [payer, alice],
    expect: 'any', // after setup the record exists; launch-guard.ts checks NotLaunchAuthority on a fresh chain
  },
  {
    name: 'the launch authority records a second mint',
    setup: [],
    attack: [setMintIx(payer.publicKey, mint, payer.publicKey)],
    signers: [payer],
    expect: 'any', // the mint record already exists, so creating it again fails
  },
  {
    name: 'seal an envelope of a lookalike token (fake mint)',
    setup: fakeForSeal.ixs,
    attack: [sealIx(alice.publicKey, id, fakeForSeal.fakeAta, fakeForSeal.fake.publicKey, [range(0n, T)])],
    signers: [payer, alice, fakeForSeal.fake],
    expect: E.WrongMint,
  },
  { name: 'seal with 9 ranges', setup: [], attack: [sealIx(alice.publicKey, id, A, mint, Array.from({ length: 9 }, (_, i) => range(1_000_000n * T + BigInt(i) * 10n, 1n)))], signers: [payer, alice], expect: E.BadRangeCount },
  { name: 'seal with an empty range', setup: [], attack: [sealIx(alice.publicKey, id, A, mint, [range(1_000_000n * T, 0n)])], signers: [payer, alice], expect: E.EmptyRange },
  { name: 'seal with overlapping ranges', setup: [], attack: [sealIx(alice.publicKey, id, A, mint, [range(1_000_000n * T, 10n), range(1_000_000n * T + 5n, 10n)])], signers: [payer, alice], expect: E.UnsortedRanges },
  { name: 'bob lists alice\'s envelope', setup: [seal], attack: [listIx(bob.publicKey, envelope, price)], signers: [payer, alice, bob], expect: E.WrongHolder },
  { name: 'bob gifts alice\'s envelope to himself', setup: [seal], attack: [giftIx(bob.publicKey, envelope, bob.publicKey)], signers: [payer, alice, bob], expect: E.WrongHolder },
  { name: 'bob withdraws alice\'s envelope to his account', setup: [seal], attack: [withdrawIx(bob.publicKey, envelope, vault, ata(bob.publicKey), mint)], signers: [payer, alice, bob], expect: E.WrongHolder },
  { name: 'list for a price of zero', setup: [seal], attack: [listIx(alice.publicKey, envelope, 0n)], signers: [payer, alice], expect: E.ZeroPrice },
  { name: 'list twice', setup: [seal, list], attack: [listIx(alice.publicKey, envelope, price * 2n)], signers: [payer, alice], expect: E.WrongStatus },
  { name: 'withdraw while listed', setup: [seal, list], attack: [withdrawIx(alice.publicKey, envelope, vault, A, mint)], signers: [payer, alice], expect: E.WrongStatus },
  { name: 'gift while listed', setup: [seal, list], attack: [giftIx(alice.publicKey, envelope, bob.publicKey)], signers: [payer, alice], expect: E.WrongStatus },
  { name: 'buy an envelope that is not listed', setup: [seal], attack: [buyEnvelopeIx(carol.publicKey, alice.publicKey, envelope, price)], signers: [payer, alice, carol], expect: E.WrongStatus },
  { name: 'seller raises the price before the purchase lands', setup: [seal, list], attack: [buyEnvelopeIx(carol.publicKey, alice.publicKey, envelope, price - 1n)], signers: [payer, alice, carol], expect: E.PriceChanged },
  { name: 'buyer redirects payment to himself', setup: [seal, list], attack: [buyEnvelopeIx(carol.publicKey, carol.publicKey, envelope, price)], signers: [payer, alice, carol], expect: E.WrongHolder },
  { name: 'buyer sends the desk fee to their own wallet', setup: [seal, list], attack: [buyEnvelopeIx(carol.publicKey, alice.publicKey, envelope, price, carol.publicKey)], signers: [payer, alice, carol], expect: E.WrongTreasury },
  { name: 'seller buys own listing', setup: [seal, list], attack: [buyEnvelopeIx(alice.publicKey, alice.publicKey, envelope, price)], signers: [payer, alice], expect: E.SelfPurchase },
  {
    name: 'withdraw into an account of a different token',
    setup: [seal, ...fakeForWithdraw.ixs],
    attack: [withdrawIx(alice.publicKey, envelope, vault, fakeForWithdraw.fakeAta, mint)],
    signers: [payer, alice, fakeForWithdraw.fake],
    expect: E.ConstraintTokenMint,
  },
  {
    name: 'withdraw using another envelope\'s vault',
    setup: [seal],
    attack: [withdrawIx(alice.publicKey, envelope, envelopePdas(id + 50n).vault, A, mint)],
    signers: [payer, alice],
    expect: 'any', // the bogus vault does not exist, so account loading fails before has_one runs
  },
];

// Control: the honest happy path in one transaction, which must succeed.
const happy = [seal, list, buyEnvelopeIx(carol.publicKey, alice.publicKey, envelope, price), giftIx(carol.publicKey, envelope, bob.publicKey), withdrawIx(bob.publicKey, envelope, vault, ata(bob.publicKey), mint)];

async function simulate(ixs: TransactionInstruction[], signers: Keypair[]) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  // Sign with only the keys this transaction actually requires.
  const needed = new Set(tx.compileMessage().accountKeys.slice(0, tx.compileMessage().header.numRequiredSignatures).map((k) => k.toBase58()));
  tx.sign(...signers.filter((s) => needed.has(s.publicKey.toBase58())));
  const res = await connection.simulateTransaction(tx);
  return res.value;
}

let failures = 0;
const report = (ok: boolean, line: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${line}`);
};

console.log(`envelope id ${id} (simulated only)\n`);
const control = await simulate(happy, [payer, alice, bob, carol]);
report(control.err === null, `control: seal → list → buy → gift → withdraw succeeds${control.err ? ` (got ${JSON.stringify(control.err)})` : ''}`);

for (const c of cases) {
  if (c.setup.length) {
    const s = await simulate(c.setup, c.signers);
    if (s.err) {
      report(false, `${c.name}: setup itself failed ${JSON.stringify(s.err)}`);
      continue;
    }
  }
  const r = await simulate([...c.setup, ...c.attack], c.signers);
  const err = r.err as any;
  const atIx = err?.InstructionError?.[0];
  const code = err?.InstructionError?.[1]?.Custom;
  const blocked = err !== null && (c.expect === 'any' || (atIx === c.setup.length && code === c.expect));
  report(blocked, `${c.name}: ${err === null ? 'ACCEPTED' : `rejected ${code !== undefined ? `with code ${code}` : JSON.stringify(err)}`}${c.expect !== 'any' ? ` (expected ${c.expect})` : ''}`);
}

console.log(failures ? `\n${failures} case(s) failed` : `\nall ${cases.length + 1} cases behave correctly`);
process.exit(failures ? 1 : 0);
