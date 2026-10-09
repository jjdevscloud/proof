// Launch discovery (pre-launch mode). The vault program is deployed before the token exists; right
// after the token is created on pump.fun, the launch authority records its mint and curve token
// account in the program (`set_mint`). This module finds that record and re-checks the token
// against the rules, so the indexer can go live without a new config or a restart. Reads use
// 'confirmed' so going live takes seconds; the ledger itself only ever reads finalized blocks.
import { createHash } from 'node:crypto';
import { encodeBase58 } from './base58.ts';
import type { Rpc } from './rpc.ts';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const T = 1_000_000n;
const SUPPLY = 1_000_000_000n * T;
// pump.fun curves start with 1,073,000,000 virtual tokens; virtual minus real stays constant for the
// life of the curve (buys and sells move both by the same amount), so it identifies the curve's
// saleable amount from the curve account alone, unaffected by tokens sent into its token account.
const PUMP_INITIAL_VIRTUAL_TOKENS = 1_073_000_000n * T;
const RECORD_SIZE = 8 + 32 + 32 + 1; // discriminator, mint, curve token account, bump
const RECORD_DISC = createHash('sha256').update('account:MintRecord').digest().subarray(0, 8);

export type Launch = { mint: string; curveTokenAccount: string };

// The mint record, or null while the token has not been recorded yet.
export async function findMintRecord(rpc: Rpc, vaultProgramId: string): Promise<Launch | null> {
  const accounts = await rpc.call<{ pubkey: string; account: { data: [string, string] } }[]>('getProgramAccounts', [
    vaultProgramId,
    { encoding: 'base64', commitment: 'confirmed', filters: [{ dataSize: RECORD_SIZE }] },
  ]);
  for (const a of accounts) {
    const data = Buffer.from(a.account.data[0], 'base64');
    if (!data.subarray(0, 8).equals(RECORD_DISC)) continue;
    return { mint: encodeBase58(data.subarray(8, 40)), curveTokenAccount: encodeBase58(data.subarray(40, 72)) };
  }
  return null;
}

type Parsed = { value: { owner: string; data: { parsed?: { info: any } } | [string, string] } | null };

// The same checks as ops/check-mint.ts, from the indexer's side. Returns the failures (empty = ok).
export async function checkLaunch(rpc: Rpc, launch: Launch, pumpProgramId: string, saleableSupply: bigint): Promise<string[]> {
  const failures: string[] = [];
  const fail = (ok: boolean, label: string) => !ok && failures.push(label);
  const parsed = async (address: string) =>
    (await rpc.call<Parsed>('getAccountInfo', [address, { encoding: 'jsonParsed', commitment: 'confirmed' }])).value;

  const mint = await parsed(launch.mint);
  const info = (mint?.data as any)?.parsed?.info;
  fail(!!info && (mint!.owner === TOKEN || mint!.owner === TOKEN_2022), 'mint is not an SPL Token or Token-2022 mint');
  if (info) {
    fail(info.decimals === 6, `decimals ${info.decimals}, expected 6`);
    // At most 1,000,000,000: anyone may burn tokens before this check runs.
    fail(/^[0-9]+$/.test(info.supply) && BigInt(info.supply) <= SUPPLY && BigInt(info.supply) > 0n, `supply ${info.supply}, expected at most ${SUPPLY}`);
    fail(info.mintAuthority === null, 'mint authority not revoked');
    fail(info.freezeAuthority === null, 'freeze authority not revoked');
    const exts: string[] = (info.extensions ?? []).map((e: any) => e.extension);
    fail(exts.every((e) => e === 'metadataPointer' || e === 'tokenMetadata'), `risky extensions: ${exts.join(', ')}`);
  }

  const curveTokens = await parsed(launch.curveTokenAccount);
  const tokenInfo = (curveTokens?.data as any)?.parsed?.info;
  fail(tokenInfo?.mint === launch.mint, 'curve token account is not a token account of this mint');
  if (tokenInfo) {
    // The curve token account belongs to the pump.fun bonding curve.
    const curve = await rpc.call<Parsed>('getAccountInfo', [tokenInfo.owner, { encoding: 'base64', commitment: 'confirmed' }]);
    fail(curve.value?.owner === pumpProgramId, 'curve token account is not owned by a pump.fun bonding curve');
    if (curve.value?.owner === pumpProgramId) {
      // Layout: discriminator 8 | virtual token u64 | virtual sol u64 | real token u64 | real sol u64 | total supply u64 | complete bool
      const data = Buffer.from((curve.value.data as [string, string])[0], 'base64');
      const virtualTokens = data.readBigUInt64LE(8);
      const realTokens = data.readBigUInt64LE(24);
      const totalSupply = data.readBigUInt64LE(40);
      fail(totalSupply === SUPPLY, `curve total supply ${totalSupply}, expected ${SUPPLY}`);
      const saleable = PUMP_INITIAL_VIRTUAL_TOKENS - (virtualTokens - realTokens);
      fail(saleable === saleableSupply, `saleable on the curve ${saleable}, expected ${saleableSupply}`);
    }
  }
  return failures;
}
