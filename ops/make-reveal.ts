// Launch step 3 (after the seed point): build the reveal file from the public seed block and post
// the reveal memo.
//
//   node make-reveal.ts --rules ../rules/sequents-v1.json --api <indexer url> --out <reveal.json> \
//     --rpc <url> [--key <reveal-authority.json> --post]
//
// The indexer must already have passed the seed point (it fixes how many Strikes were fully sold).
// Put the written file where the indexer's `revealFile` points BEFORE posting the memo.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deriveTraits, parseRules } from '../indexer/src/derive.ts';
import { buildRevealBytes, parseReveal } from '../indexer/src/reveal.ts';
import { args, connection, firstBlockFrom, loadKey, need, postMemo } from './common.ts';

const a = args();
const conn = connection(a);
const rulesText = readFileSync(need(a, 'rules'), 'utf8');
const rules = parseRules(rulesText);
const rulesHash = createHash('sha256').update(rulesText).digest('hex');

const status = (await (await fetch(`${need(a, 'api').replace(/\/$/, '')}/reveal`)).json()) as any;
if (status.commitRoot !== rulesHash) throw new Error(`indexer's commitment ${status.commitRoot} is not this rules file (${rulesHash})`);
if (status.revealed) throw new Error('already revealed');
if (!status.seedFixed) throw new Error(`seed point not reached yet: target slot ${status.seedTargetSlot}; the indexer must pass it first`);

const seed = await firstBlockFrom(conn, status.seedTargetSlot);
const bytes = buildRevealBytes(rulesText, status.seedTargetSlot, seed.slot, seed.blockhash, status.eligibleStrikes);
const { data, fileHash } = parseReveal(bytes); // same checks the indexer runs
const out = need(a, 'out');
writeFileSync(out, bytes);
const memo = `proof:v1:reveal:${fileHash}`;

const rare = data.strikes.filter((s) => s.traits.length > 1);
console.log(`seed target slot   ${data.seedTargetSlot}`);
console.log(`seed block         slot ${seed.slot}, hash ${seed.blockhash}`);
console.log(`eligible Strikes   ${data.eligibleStrikes}`);
for (const e of rules.errors) {
  console.log(`  ${e.name.padEnd(17)} ${rare.filter((s) => s.traits.includes(e.name)).map((s) => `#${s.strike}`).join(' ')}`);
}
console.log(`reveal file        ${out} (sha256 ${fileHash})`);
console.log(`memo               ${memo}`);

// The memo is only safe once the indexer has registered this exact file (it builds it itself from the
// same public data). A memo for a file the indexer does not have would halt it.
const registered: string[] = status.registered ?? [];
console.log(`indexer has it     ${registered.includes(fileHash) ? 'yes' : `NO (registered: ${registered.join(', ') || 'none yet'})`}`);
if (a.post) {
  if (!registered.includes(fileHash)) throw new Error('the indexer has not registered this reveal file yet; wait a few seconds and retry');
  const key = loadKey(need(a, 'key'));
  const { signature, slot } = await postMemo(conn, key, memo);
  console.log(`reveal memo finalized in slot ${slot}: ${signature}`);
} else {
  console.log('\n(dry run: add --key <reveal-authority.json> --post to post the memo)');
}
