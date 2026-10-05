// In-browser verification of the reveal (SPEC §4): no trust in this website or the indexer.
// Uses the indexer's own derivation module, so the browser runs the exact same code.
import { deriveTraits, hex, parseRules, sha256, utf8 } from '../../indexer/src/derive.ts';
import type { StrikeTraits } from '../../indexer/src/derive.ts';
import { api } from './api.ts';
import type { Config, RevealStatus } from './api.ts';
import { connection } from './chain.ts';
import { DEMO, demoTraits } from './demo.ts';

export type Step = { label: string; ok: boolean; detail: string };
export type Verification = { ok: boolean; steps: Step[]; traits: StrikeTraits[] | null; reveal: RevealStatus };

let cached: Promise<Verification> | null = null;

// Verifies the whole reveal once per page load; every Strike check reuses the result.
export function verifyReveal(config: Config): Promise<Verification> {
  cached ??= run(config).catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}

async function run(config: Config): Promise<Verification> {
  const reveal = await api<RevealStatus>('/reveal');
  const steps: Step[] = [];
  if (DEMO) {
    const ok = (label: string) => ({ label, ok: true, detail: 'demo' });
    return { ok: true, traits: demoTraits, reveal, steps: [ok('Rules match the commitment posted before launch'), ok(`Seed block is the first block at or after slot ${reveal.seedTargetSlot}`), ok('Seed block hash matches the chain'), ok('Traits recomputed in your browser')] };
  }
  const add = (label: string, ok: boolean, detail = '') => steps.push({ label, ok, detail });
  if (!reveal.revealed || !reveal.rules || !reveal.blockhash || reveal.seedSlot === undefined) {
    return { ok: false, steps, traits: null, reveal };
  }

  const rulesHash = hex(sha256(utf8(reveal.rules)));
  add('Rules match the commitment posted before launch', rulesHash === config.commitRoot, `${rulesHash.slice(0, 16)}…`);

  const firstSlot = (await connection.getBlocks(reveal.seedTargetSlot!, reveal.seedTargetSlot! + 500, 'finalized'))[0];
  add(`Seed block is the first block at or after slot ${reveal.seedTargetSlot}`, firstSlot === reveal.seedSlot, `slot ${firstSlot}`);

  const block = await connection.getBlock(reveal.seedSlot, { transactionDetails: 'none', rewards: false, maxSupportedTransactionVersion: 1 });
  add('Seed block hash matches the chain', block?.blockhash === reveal.blockhash, `${reveal.blockhash.slice(0, 12)}…`);

  const rules = parseRules(reveal.rules);
  const traits = deriveTraits(rules, reveal.blockhash, reveal.eligibleStrikes ?? 0);
  add('Traits recomputed in your browser', traits.length === rules.strikeCount, `${reveal.eligibleStrikes} Strikes were eligible for errors`);
  return { ok: steps.every((s) => s.ok), steps, traits, reveal };
}

// Does the indexer's view of a Strike match what this browser derived?
export function matches(v: Verification, strike: number, indexerTraits: string[] | null): boolean {
  const t = v.traits?.[strike];
  return !!t && JSON.stringify(t.traits) === JSON.stringify(indexerTraits);
}
