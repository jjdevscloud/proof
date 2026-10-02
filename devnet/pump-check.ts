// Checks the production decoder against REAL pump.fun transactions on mainnet (read-only).
//
// For every token transfer directly under a pump.fun instruction, it derives that token's real
// bonding-curve token account (ATA of the PDA ["bonding-curve", mint]) — exactly what the indexer
// config points at in production. For transfers OUT of that account it runs the production Decoder
// and checks: buy instructions -> curveBuy, anything else -> not a curveBuy. Quote-token movements
// (V2 curves trade against a quote token) come from other accounts and are correctly ignored.
// Usage: node pump-check.ts [count=150] [rpcUrl]
import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Decoder, executionOrder } from '../indexer/src/decoder.ts';

const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const NON_BUY = ['migrate', 'withdraw'];
const RPC = process.argv[3] ?? 'https://api.mainnet-beta.solana.com';
const COUNT = Number(process.argv[2] ?? 150);
const UNUSED = '11111111111111111111111111111111';

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (res.status === 429 && attempt < 8) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    const body = (await res.json()) as any;
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  }
}

const curveCache = new Map<string, string>();
function curveTokenAccount(mint: string, tokenProgramId: string): string {
  const key = `${mint}:${tokenProgramId}`;
  let v = curveCache.get(key);
  if (!v) {
    const m = new PublicKey(mint);
    const bondingCurve = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), m.toBuffer()], PUMP)[0];
    const program = tokenProgramId === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    v = getAssociatedTokenAddressSync(m, bondingCurve, true, program).toBase58();
    curveCache.set(key, v);
  }
  return v;
}

function pumpNamesFromLogs(logs: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < logs.length; i++) {
    if (logs[i].startsWith(`Program ${PUMP.toBase58()} invoke`)) out.push(/Instruction: (\w+)/.exec(logs[i + 1] ?? '')?.[1] ?? '(event)');
  }
  return out;
}

const sigs = await rpc<{ signature: string; err: unknown }[]>('getSignaturesForAddress', [PUMP.toBase58(), { limit: COUNT }]);
const outflowsByIx = new Map<string, number>();
const byVersion = new Map<string, number>();
const byTokenProgram = new Map<string, number>();
let txs = 0, outflows = 0, routed = 0, correct = 0, falseBuysElsewhere = 0;
const problems: string[] = [];

for (const s of sigs.filter((x) => x.err === null)) {
  await new Promise((r) => setTimeout(r, 200));
  const tx = await rpc<any>('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
  if (!tx || tx.meta.err) continue;
  txs++;
  byVersion.set(String(tx.version), (byVersion.get(String(tx.version)) ?? 0) + 1);

  const order = executionOrder(tx);
  const names = pumpNamesFromLogs(tx.meta.logMessages ?? []);
  const keys = tx.transaction.message.accountKeys.map((k: any) => k.pubkey);
  const balances = [...(tx.meta.preTokenBalances ?? []), ...(tx.meta.postTokenBalances ?? [])];
  const balanceOf = (acct: string) => balances.find((b: any) => keys[b.accountIndex] === acct);

  order.filter((o) => o.ix.programId === PUMP.toBase58()).forEach((p, i) => {
    const name = names[i] ?? '?';
    const transfers = order.filter((o) => o.parent === p.ix && o.ix.parsed && (o.ix.programId === TOKEN_PROGRAM_ID.toBase58() || o.ix.programId === TOKEN_2022_PROGRAM_ID.toBase58()) && /^transfer(Checked)?$/.test(o.ix.parsed.type));
    for (const c of transfers) {
      const info = c.ix.parsed.info;
      const b = balanceOf(info.source) ?? balanceOf(info.destination);
      const mint: string | undefined = info.mint ?? b?.mint;
      if (!mint) {
        problems.push(`${s.signature.slice(0, 12)}… ${name}: token transfer with no identifiable mint`);
        continue;
      }
      const curve = curveTokenAccount(mint, c.ix.programId);
      const decoder = new Decoder({ mint, curveTokenAccount: curve, pumpProgramId: PUMP.toBase58(), pumpNonBuyInstructions: NON_BUY, vaultProgramId: UNUSED, revealAuthority: UNUSED });
      const events = decoder.decode(tx)!.events;
      const amount = BigInt(info.amount ?? info.tokenAmount.amount);
      if (info.source !== curve) {
        // Not the launched token leaving its curve (e.g. a sell into the curve, or quote tokens).
        if (events.some((e) => e.kind === 'curveBuy' && e.amount === amount && e.to === info.destination)) {
          falseBuysElsewhere++;
          problems.push(`${s.signature.slice(0, 12)}… ${name}: non-curve transfer decoded as a buy`);
        }
        continue;
      }
      outflows++;
      if (p.parent) routed++;
      outflowsByIx.set(name, (outflowsByIx.get(name) ?? 0) + 1);
      const tp = c.ix.programId === TOKEN_2022_PROGRAM_ID.toBase58() ? 'Token-2022' : 'SPL Token';
      byTokenProgram.set(tp, (byTokenProgram.get(tp) ?? 0) + 1);
      const isBuy = /^Buy/.test(name);
      const got = events.some((e) => e.kind === 'curveBuy' && e.amount === amount && e.to === info.destination);
      if (got === isBuy) correct++;
      else problems.push(`${s.signature.slice(0, 12)}… ${name}: curve outflow decoded as ${got ? 'a buy' : 'NOT a buy'}`);
    }
  });
}

console.log(`transactions examined: ${txs}  by version: ${JSON.stringify(Object.fromEntries(byVersion))}`);
console.log('launched-token outflows from the curve, by pump.fun instruction:', Object.fromEntries(outflowsByIx));
console.log('token programs:', Object.fromEntries(byTokenProgram));
console.log(`curve outflows: ${outflows} (routed via another program: ${routed}); classified correctly: ${correct}`);
console.log(`other token transfers misread as buys: ${falseBuysElsewhere}`);
console.log(problems.length ? `\nproblems:\n  ${problems.join('\n  ')}` : '\nno problems');
process.exit(problems.length ? 1 : 0);
