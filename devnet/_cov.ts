// For live pump.fun tokens: are all transactions that touch holders' token accounts listed under the mint?
import { Rpc } from '../indexer/src/rpc.ts';
const rpc = new Rpc(process.argv[2]);
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const tip = await rpc.call<number>('getSlot', [{ commitment: 'finalized' }]);
const from = tip - 1500, to = tip - 10;
const pumpSigs = await rpc.call<any[]>('getSignaturesForAddress', [PUMP, { limit: 40 }]);
const mints = new Set<string>();
for (const s of pumpSigs) {
  const tx = await rpc.transaction(s.signature);
  for (const b of tx?.meta?.postTokenBalances ?? []) if (!b.mint.startsWith('So111') && !b.mint.startsWith('EPjF')) mints.add(b.mint);
  if (mints.size >= 4) break;
}
let total = 0, covered = 0;
for (const mint of mints) {
  const mintSigs = new Set((await rpc.signatures(mint, from, to)).map((s) => s.signature));
  // token accounts of this mint touched recently
  const accounts = new Set<string>();
  for (const sig of [...mintSigs].slice(0, 15)) {
    const tx = await rpc.transaction(sig);
    const keys = tx.transaction.message.accountKeys.map((k: any) => k.pubkey);
    for (const b of tx.meta.postTokenBalances ?? []) if (b.mint === mint) accounts.add(keys[b.accountIndex]);
  }
  for (const acct of [...accounts].slice(0, 12)) {
    for (const s of await rpc.signatures(acct, from, to)) {
      if (s.err) continue;
      const tx = await rpc.transaction(s.signature);
      const keys = tx.transaction.message.accountKeys.map((k: any) => k.pubkey);
      const idx = keys.indexOf(acct);
      const pre = tx.meta.preTokenBalances.find((b: any) => b.accountIndex === idx)?.uiTokenAmount.amount ?? '0';
      const post = tx.meta.postTokenBalances.find((b: any) => b.accountIndex === idx)?.uiTokenAmount.amount ?? '0';
      if (pre === post) continue; // only transactions that moved this account's tokens matter
      total++;
      if (mintSigs.has(s.signature)) covered++;
    }
  }
  console.log(`${mint.slice(0, 8)}: ${covered}/${total} balance-changing holder transactions so far are listed under the mint`);
}
