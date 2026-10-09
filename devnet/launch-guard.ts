// On a FRESH local validator (before setup.ts): nobody but the launch authority can record the mint.
// Simulated only, so the chain is left untouched for setup.ts.
// Usage: RPC_URL=http://127.0.0.1:8899 node launch-guard.ts
import { LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { connection, key, mintRecordPda, setMintIx } from './lib.ts';

if (!/127.0.0.1|localhost/.test(connection.rpcEndpoint)) throw new Error('run against a fresh local validator only');
if (await connection.getAccountInfo(mintRecordPda())) throw new Error('mint already recorded: restart the validator with --reset first');

const [payer, alice] = (['payer', 'alice'] as const).map(key);
for (const kp of [payer, alice]) {
  await connection.confirmTransaction(await connection.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL), 'confirmed');
}

async function simulate(signer: typeof payer, mint: PublicKey) {
  const tx = new Transaction().add(setMintIx(signer.publicKey, mint, signer.publicKey));
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(signer);
  return (await connection.simulateTransaction(tx)).value.err as any;
}
const code = (err: any) => err?.InstructionError?.[1]?.Custom;

let failures = 0;
const report = (ok: boolean, line: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${line}`);
};
const stranger = await simulate(alice, NATIVE_MINT);
report(code(stranger) === 6013, `a stranger cannot record a mint (code ${code(stranger) ?? JSON.stringify(stranger)}, expected 6013 NotLaunchAuthority)`);
const badMint = await simulate(payer, NATIVE_MINT);
report(code(badMint) === 6014, `the launch authority cannot record a mint that is not fixed-supply $PROOF-shaped (code ${code(badMint) ?? JSON.stringify(badMint)}, expected 6014 BadMint)`);
console.log(failures ? `\n${failures} check(s) failed` : '\nlaunch guard holds');
process.exit(failures ? 1 : 0);
