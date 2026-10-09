// Reveal file (SPEC §4): the committed rules plus the public seed block, and the traits they derive.
import { createHash } from 'node:crypto';
import { RulesError, deriveTraits, parseRules } from './derive.ts';
import type { Rules, StrikeTraits } from './derive.ts';

export type RevealData = {
  version: 1;
  rules: string; // exact text of the rules file; sha256 of it is the committed hash
  seedTargetSlot: number; // min(curve completion slot + 150, deadline) — recomputed by the ledger
  seedSlot: number; // the first produced block at or after seedTargetSlot
  blockhash: string; // that block's hash (base58) — checked against the chain by the operator and browsers
  eligibleStrikes: number; // Strikes fully sold by seedTargetSlot — recomputed by the ledger
  strikes: StrikeTraits[]; // deriveTraits(rules, blockhash, eligibleStrikes)
};

export class RevealError extends Error {}

// The reveal file's exact bytes. Everything in it is public, so the operator's tool and every
// indexer build byte-identical files (and the same hash) independently.
export function buildRevealBytes(rulesText: string, seedTargetSlot: number, seedSlot: number, blockhash: string, eligibleStrikes: number): Buffer {
  const data: RevealData = {
    version: 1,
    rules: rulesText,
    seedTargetSlot,
    seedSlot,
    blockhash,
    eligibleStrikes,
    strikes: deriveTraits(parseRules(rulesText), blockhash, eligibleStrikes),
  };
  return Buffer.from(JSON.stringify(data));
}

export function sha256(data: Uint8Array | string): Buffer {
  return createHash('sha256').update(data).digest();
}

// Structural checks plus the derivation itself. Chain facts (seed slot, blockhash, eligible count)
// are checked by the ledger (slot rules) and by the operator's RPC lookup (blockhash).
export function parseReveal(bytes: Uint8Array): { data: RevealData; rules: Rules; fileHash: string; rulesHash: string } {
  let data: RevealData;
  try {
    data = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new RevealError('reveal file is not valid JSON');
  }
  if (data.version !== 1 || typeof data.rules !== 'string' || !Array.isArray(data.strikes)) throw new RevealError('unsupported reveal file');
  let rules: Rules;
  try {
    rules = parseRules(data.rules);
  } catch (e) {
    throw new RevealError(`rules: ${(e as RulesError).message}`);
  }
  for (const k of ['seedTargetSlot', 'seedSlot', 'eligibleStrikes'] as const) {
    if (!Number.isSafeInteger(data[k]) || data[k] < 0) throw new RevealError(`${k} must be a non-negative integer`);
  }
  if (data.seedSlot < data.seedTargetSlot) throw new RevealError('seed block is before the seed target slot');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data.blockhash)) throw new RevealError('blockhash is not base58');
  const expected = JSON.stringify(deriveTraits(rules, data.blockhash, data.eligibleStrikes));
  if (JSON.stringify(data.strikes) !== expected) throw new RevealError('strikes do not match the rules and seed');
  return { data, rules, fileHash: sha256(bytes).toString('hex'), rulesHash: sha256(data.rules).toString('hex') };
}
