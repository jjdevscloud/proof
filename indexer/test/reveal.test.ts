import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deriveTraits, parseRules, sha256, utf8 } from '../src/derive.ts';
import { parseReveal } from '../src/reveal.ts';
import { encodeBase58 } from '../src/base58.ts';

const TEMPLATE = readFileSync(new URL('../../rules/sequents-v1.template.json', import.meta.url), 'utf8');
export const rulesText = (deadlineSlot: number) => TEMPLATE.replace('"deadlineSlot": 0', `"deadlineSlot": ${deadlineSlot}`);
const rules = parseRules(rulesText(1000));
const hashN = (n: number) => encodeBase58(createHash('sha256').update(`block ${n}`).digest());

test('sha256 matches node:crypto across padding boundaries', () => {
  for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
    const data = Uint8Array.from({ length: len }, (_, i) => (i * 31 + 7) & 0xff);
    assert.equal(Buffer.from(sha256(data)).toString('hex'), createHash('sha256').update(data).digest('hex'), `len ${len}`);
  }
});

test('the approved rules file parses', () => {
  assert.equal(rules.strikeCount, 794);
  assert.equal(rules.errors.reduce((n, e) => n + e.count, 0), 93);
});

test('derivation: exact counts, one error per Strike, date tiers, stacked ranks', () => {
  const s = deriveTraits(rules, hashN(1), 794);
  for (const e of rules.errors) assert.equal(s.filter((x) => x.traits.includes(e.name)).length, e.count, e.name);
  assert.ok(s.every((x) => x.traits.length <= 2), 'at most one error each');
  assert.deepEqual(s.slice(0, 5).map((x) => x.traits[0]), Array(5).fill('Genesis'));
  assert.equal(s[5].traits[0], 'Key Date');
  assert.equal(s[24].traits[0], 'Key Date');
  assert.equal(s[25].traits[0], 'Common Date');
  assert.equal(s[793].traits[0], 'Final Strike');
  for (const x of s) {
    const pts = (n: string) => [...rules.dates, rules.defaultDate, ...rules.errors].find((t) => t.name === n)!.points;
    assert.equal(x.rank, x.traits.reduce((t, n) => t + pts(n), 0));
  }
});

test('derivation is deterministic and depends on the seed', () => {
  assert.deepEqual(deriveTraits(rules, hashN(7), 794), deriveTraits(rules, hashN(7), 794));
  assert.notDeepEqual(deriveTraits(rules, hashN(7), 794), deriveTraits(rules, hashN(8), 794));
});

test('errors only go to Strikes fully sold at the seed point', () => {
  const s = deriveTraits(rules, hashN(2), 300);
  assert.ok(s.slice(300).every((x) => x.traits.length === 1), 'unsold Strikes stay error-free');
  assert.equal(s.filter((x) => x.traits.length === 2).length, 93);
  const few = deriveTraits(rules, hashN(3), 10);
  assert.equal(few.filter((x) => x.traits.length === 2).length, 10, 'all eligible get one when errors outnumber them');
  assert.equal(few.filter((x) => x.traits.includes('Double Die')).length, 3, 'rarest errors are assigned first');
});

test('every eligible Strike has a fair chance (no position bias)', () => {
  const r = parseRules(JSON.stringify({ ...rules, dates: [], errors: [{ name: 'Hit', count: 1, points: 1 }] }));
  const hits = Array(10).fill(0);
  for (let i = 0; i < 2000; i++) hits[deriveTraits(r, hashN(i), 10).findIndex((x) => x.traits.includes('Hit'))]++;
  assert.ok(hits.every((h) => h > 140 && h < 260), `roughly 200 each: ${hits}`);
});

test('rules validation', () => {
  const bad = (patch: object) => JSON.stringify({ ...JSON.parse(rulesText(5)), ...patch });
  assert.throws(() => parseRules(bad({ dates: [{ name: 'A', from: 0, to: 5, points: 1 }, { name: 'B', from: 5, to: 6, points: 1 }] })), /overlap/);
  assert.throws(() => parseRules(bad({ dates: [{ name: 'A', from: 0, to: 900, points: 1 }] })), /out of bounds/);
  assert.throws(() => parseRules(bad({ errors: [{ name: 'Bad|Name', count: 1, points: 1 }] })), /bad trait name/);
  assert.throws(() => parseRules(bad({ deadlineSlot: 0 })), /deadlineSlot/);
});

test('reveal file: accepts a correct one, rejects tampering', () => {
  const text = rulesText(1000);
  const good = { version: 1, rules: text, seedTargetSlot: 900, seedSlot: 902, blockhash: hashN(5), eligibleStrikes: 794, strikes: deriveTraits(rules, hashN(5), 794) };
  const parsed = parseReveal(utf8(JSON.stringify(good)));
  assert.equal(parsed.rulesHash, createHash('sha256').update(text).digest('hex'));
  const tampered = structuredClone(good);
  tampered.strikes[100] = { strike: 100, rank: 140, traits: ['Common Date', 'Double Die'] };
  assert.throws(() => parseReveal(utf8(JSON.stringify(tampered))), /do not match/);
  assert.throws(() => parseReveal(utf8(JSON.stringify({ ...good, seedSlot: 899 }))), /before the seed target/);
});
