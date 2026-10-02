// Runs the vault's full flow against a Token-2022 mint shaped exactly like a real pump.fun token
// (decimals 6, metadataPointer + tokenMetadata extensions, mint and freeze authority revoked),
// on a LOCAL validator. The mint is created at the devnet mint address that PROOF_MINT points to,
// so the exact deployed program binary is tested.
// Usage: RPC_URL=http://127.0.0.1:8899 node token2022-local.ts
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  AuthorityType, ExtensionType, TOKEN_2022_PROGRAM_ID, TYPE_SIZE, LENGTH_SIZE, createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMetadataPointerInstruction, createInitializeMintInstruction, createMintToInstruction, createSetAuthorityInstruction,
  getAccount, getAssociatedTokenAddressSync, getMint, getMintLen, getExtensionTypes,
} from '@solana/spl-token';
import { createInitializeInstruction, pack } from '@solana/spl-token-metadata';
import { T, connection, disc, envelopePdas, key, programId, u64, vaultConfigPda } from './lib.ts';

if (!connection.rpcEndpoint.includes('127.0.0.1') && !connection.rpcEndpoint.includes('localhost')) {
  throw new Error('This test creates the PROOF_MINT address; run it only against a local validator (RPC_URL=http://127.0.0.1:8899).');
}

const TP = TOKEN_2022_PROGRAM_ID;
const [payer, alice, carol] = (['payer', 'alice', 'carol'] as const).map(key);
const mintKp = key('mint');
const mint = mintKp.publicKey;
const vaultProgram = programId('proof_vault');
let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`);
};
const send = (ixs: any[], signers: Keypair[]) => sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers, { commitment: 'confirmed' });

for (const kp of [payer, alice, carol]) {
  const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, 'confirmed');
}

// 1. Token-2022 mint like pump.fun's: metadata pointer to itself + token metadata, no other extensions.
const metadata = { mint, name: 'Proof Test', symbol: 'PROOF', uri: 'https://example.com/proof.json', additionalMetadata: [] as [string, string][], updateAuthority: payer.publicKey };
const mintLen = getMintLen([ExtensionType.MetadataPointer]);
const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);
await send([
  SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint, space: mintLen, lamports, programId: TP }),
  createInitializeMetadataPointerInstruction(mint, payer.publicKey, mint, TP),
  createInitializeMintInstruction(mint, 6, payer.publicKey, null, TP),
  createInitializeInstruction({ programId: TP, metadata: mint, updateAuthority: payer.publicKey, mint, mintAuthority: payer.publicKey, name: metadata.name, symbol: metadata.symbol, uri: metadata.uri }),
], [payer, mintKp]);
const aliceAta = getAssociatedTokenAddressSync(mint, alice.publicKey, false, TP);
await send([
  createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, aliceAta, alice.publicKey, mint, TP),
  createMintToInstruction(mint, aliceAta, payer.publicKey, 2_000_000n * T, [], TP),
  createSetAuthorityInstruction(mint, payer.publicKey, AuthorityType.MintTokens, null, [], TP),
], [payer]);
const mintInfo = await getMint(connection, mint, 'confirmed', TP);
const exts = getExtensionTypes(mintInfo.tlvData).map((e) => ExtensionType[e]);
check(exts.join(',') === 'MetadataPointer,TokenMetadata', `mint has exactly pump.fun's extensions: ${exts.join(', ')}`);
check(mintInfo.mintAuthority === null && mintInfo.freezeAuthority === null, 'mint and freeze authority revoked');

// 2. Vault flow with Token-2022: initialize, seal, list, buy, withdraw.
const ix = (name: string, keys: [PublicKey, boolean, boolean][], data: Buffer = Buffer.alloc(0)) => ({
  programId: vaultProgram,
  keys: keys.map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })),
  data: Buffer.concat([disc(name), data]),
});
await send([ix('initialize', [[payer.publicKey, true, true], [vaultConfigPda(), false, true], [SystemProgram.programId, false, false]])], [payer]);

const id = 0n;
const { envelope, vault } = envelopePdas(id);
const sealData = Buffer.concat([Buffer.from([1, 0, 0, 0]), u64(1_000_000n * T), u64(1_000_000n * T)]);
await send([ix('seal', [
  [alice.publicKey, true, true], [vaultConfigPda(), false, true], [envelope, false, true], [vault, false, true],
  [aliceAta, false, true], [mint, false, false], [TP, false, false], [SystemProgram.programId, false, false],
], sealData)], [alice]);
const vaultAcct = await getAccount(connection, vault, 'confirmed', TP);
check(vaultAcct.amount === 1_000_000n * T, 'seal moved exactly 1,000,000 tokens into a Token-2022 vault');
check(vaultAcct.owner.equals(envelope) && vaultAcct.delegate === null && vaultAcct.closeAuthority === null, 'vault controlled only by the envelope; no delegate or close authority');
check((await connection.getAccountInfo(vault))!.owner.equals(TP), 'vault is a Token-2022 account');

const price = LAMPORTS_PER_SOL / 10;
await send([ix('list', [[alice.publicKey, true, false], [envelope, false, true]], u64(BigInt(price)))], [alice]);
const aliceSolBefore = await connection.getBalance(alice.publicKey);
await send([ix('buy', [[carol.publicKey, true, true], [alice.publicKey, false, true], [envelope, false, true], [SystemProgram.programId, false, false]], u64(BigInt(price)))], [carol]);
check((await connection.getBalance(alice.publicKey)) - aliceSolBefore === price, 'buy paid the seller exactly the listed price');

const carolAta = getAssociatedTokenAddressSync(mint, carol.publicKey, false, TP);
await send([
  createAssociatedTokenAccountIdempotentInstruction(carol.publicKey, carolAta, carol.publicKey, mint, TP),
  ix('withdraw', [[carol.publicKey, true, true], [envelope, false, true], [vault, false, true], [carolAta, false, true], [mint, false, false], [TP, false, false]]),
], [carol]);
check((await getAccount(connection, carolAta, 'confirmed', TP)).amount === 1_000_000n * T, 'withdraw delivered all 1,000,000 tokens to the new holder');
check((await connection.getAccountInfo(vault)) === null && (await connection.getAccountInfo(envelope)) === null, 'vault and envelope closed, rent returned');

console.log(failures ? `\n${failures} check(s) failed` : '\nToken-2022 (pump.fun-style) flow works end to end');
process.exit(failures ? 1 : 0);
