// Launch step 1 (before the token exists): finalise the rules file and post the commit memo.
//
//   node make-commit.ts --template ../rules/sequents-v1.template.json --out ../rules/sequents-v1.json \
//     --deadline-days 7 --rpc <url> [--key <reveal-authority.json> --post]
//
// Without --post it only writes the file and prints what would be posted. The commit memo must be
// finalized BEFORE the first buy of the token (SPEC §4.3); create the token on pump.fun after this.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseRules } from '../indexer/src/derive.ts';
import { args, connection, loadKey, need, postMemo } from './common.ts';

const SLOTS_PER_DAY = 216_000; // ~400 ms slots; the deadline is a slot number, the days are approximate

const a = args();
const conn = connection(a);
const now = await conn.getSlot('finalized');
const deadline = typeof a['deadline-slot'] === 'string' ? Number(a['deadline-slot'])
  : now + Math.round(Number(a['deadline-days'] ?? 7) * SLOTS_PER_DAY);
if (!Number.isSafeInteger(deadline) || deadline <= now) throw new Error('deadline must be a future slot');

const out = need(a, 'out');
let text: string;
if (existsSync(out)) {
  // Never silently change a rules file that may already be committed.
  text = readFileSync(out, 'utf8');
  console.log(`using existing ${out} (delete it to make a new one)`);
} else {
  const template = readFileSync(need(a, 'template'), 'utf8');
  if (!template.includes('"deadlineSlot": 0')) throw new Error('template must contain "deadlineSlot": 0');
  text = template.replace('"deadlineSlot": 0', `"deadlineSlot": ${deadline}`);
  // Only a real commit freezes the file; a dry run leaves nothing behind.
  if (a.post) writeFileSync(out, text);
}
const rules = parseRules(text);
const hash = createHash('sha256').update(text).digest('hex');
const memo = `proof:v1:commit:${hash}:${rules.deadlineSlot}`;

console.log(`rules file      ${out}`);
console.log(`rules sha256    ${hash}`);
console.log(`deadline slot   ${rules.deadlineSlot} (~${((rules.deadlineSlot - now) / SLOTS_PER_DAY).toFixed(1)} days from now)`);
console.log(`errors          ${rules.errors.map((e) => `${e.name} ×${e.count}`).join(', ')}`);
console.log(`memo            ${memo}`);
console.log(`indexer startSlot (set before the commit): ${now - 1}`);

if (a.post) {
  const key = loadKey(need(a, 'key'));
  console.log(`\nposting as reveal authority ${key.publicKey.toBase58()} ...`);
  const { signature, slot } = await postMemo(conn, key, memo);
  console.log(`commit memo finalized in slot ${slot}: ${signature}`);
  console.log('Publish the rules file now. Create the token on pump.fun only after this point.');
} else {
  console.log('\n(dry run: add --key <file> --post to post the memo)');
}
