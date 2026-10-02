// Read-only HTTP API over the ledger, plus a server-sent-events stream of changes.
import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import type { Change, Ledger, TxChanges } from './ledger.ts';
import { leafHash, merkleProof } from './reveal.ts';
import * as R from './ranges.ts';
import type { Range } from './ranges.ts';

// Public, non-secret settings the website needs to build transactions and run checks.
export type PublicConfig = {
  mint: string;
  vaultProgramId: string;
  curveTokenAccount: string;
  curveProgramId: string; // pump.fun on mainnet; the mock curve on devnet
  revealAuthority: string;
};

export type ApiState = {
  ledger: Ledger;
  syncedSlot: () => number;
  publicConfig: PublicConfig;
  history?: TxChanges[]; // oldest first; the API appends broadcast changes to it
};

export function json(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

export function createApi(state: ApiState): { server: Server; broadcast: (c: TxChanges) => void } {
  const streams = new Set<ServerResponse>();
  const history = state.history ?? [];
  // Which strikes each envelope held when sealed, so envelope events show up in strike histories.
  const envelopeStrikes = new Map<string, Set<number>>();
  const index = (c: TxChanges) => {
    for (const ch of c.changes) {
      if (ch.kind === 'seal') envelopeStrikes.set(ch.envelope, strikesOf(state.ledger, ch.ranges));
    }
  };
  history.forEach(index);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(json(body));
    };
    try {
      const l = state.ledger;
      if (req.method !== 'GET') return send(405, { error: 'GET only' });
      switch (parts[0]) {
        case 'health':
          return send(200, { syncedSlot: state.syncedSlot(), lastSlot: l.lastSlot, fingerprint: l.fingerprint(), revealed: !!l.reveal });
        case 'config':
          return send(200, {
            ...state.publicConfig,
            strikeCount: l.strikeCount,
            strikeSize: l.config.strikeSize,
            saleableSupply: l.config.saleableSupply,
            commitRoot: l.commitRoot,
            revealHash: l.revealHash,
            revealed: !!l.reveal,
          });
        case 'stats':
          return send(200, stats(l));
        case 'wallet':
          return send(200, withTraits(l, l.wallet(need(parts[1]))));
        case 'strike': {
          const n = Number(parts[1]);
          if (!Number.isInteger(n) || n < 0 || n >= l.strikeCount) return send(404, { error: 'no such strike' });
          const events = history
            .filter((c) => c.changes.some((ch) => touchesStrike(l, ch, n, envelopeStrikes)))
            .map((c) => ({ ...c, changes: c.changes.filter((ch) => touchesStrike(l, ch, n, envelopeStrikes)) }))
            .slice(-100)
            .reverse();
          return send(200, { ...l.strike(n), rank: l.rank(n), traits: l.reveal?.strikes[n].traits ?? null, history: events });
        }
        case 'strikes':
          return send(200, Array.from({ length: l.strikeCount }, (_, n) => {
            const s = l.strike(n);
            return { strike: n, rank: l.rank(n), traits: l.reveal?.strikes[n].traits ?? null, issued: s.issued, surviving: s.surviving };
          }));
        case 'envelopes': {
          const status = url.searchParams.get('status');
          const list = [...l.envelopes.values()].filter((e) => !status || e.status === status);
          return send(200, list.map((e) => envelopeView(l, e.address)));
        }
        case 'envelope': {
          const view = envelopeView(l, need(parts[1]));
          if (!view) return send(404, { error: 'no such envelope' });
          return send(200, view);
        }
        case 'activity': {
          const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 500);
          return send(200, history.slice(-limit).reverse());
        }
        case 'preview': {
          const account = need(url.searchParams.get('account'));
          const amount = BigInt(need(url.searchParams.get('amount')));
          const bal = url.searchParams.get('balance');
          const p = l.preview(account, amount, bal === null ? undefined : BigInt(bal));
          return send(200, { ...p, segments: traitsFor(l, R.splitByStrike(p.ranges, l.config.strikeSize)) });
        }
        case 'proof': {
          // Merkle proof for browser-side verification of a strike's traits (SPEC §4).
          if (!l.reveal) return send(404, { error: 'not revealed yet' });
          const n = Number(parts[1]);
          const leaves = l.reveal.strikes.map(leafHash);
          if (!leaves[n]) return send(404, { error: 'no such strike' });
          return send(200, { strike: l.reveal.strikes[n], root: l.commitRoot, proof: merkleProof(leaves, n).map((b) => b.toString('hex')) });
        }
        case 'stream':
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' });
          res.write(': connected\n\n');
          streams.add(res);
          req.on('close', () => streams.delete(res));
          return;
        default:
          return send(404, { error: 'not found' });
      }
    } catch (e) {
      return send(400, { error: (e as Error).message });
    }
  });

  const broadcast = (c: TxChanges) => {
    if (!c.changes.length) return;
    history.push(c);
    index(c);
    const msg = `data: ${json(c)}\n\n`;
    for (const s of streams) s.write(msg);
  };
  return { server, broadcast };
}

function need(v: string | null | undefined): string {
  if (!v) throw new Error('missing parameter');
  return v;
}

function traitsFor<T extends { strike: number }>(l: Ledger, segs: T[]) {
  return segs.map((seg) => ({ ...seg, rank: l.rank(seg.strike), traits: l.reveal?.strikes[seg.strike].traits ?? null }));
}

function withTraits(l: Ledger, w: ReturnType<Ledger['wallet']>) {
  return {
    accounts: w.accounts.map((a) => ({ ...a, common: l.holdings.get(a.account)?.melted ?? 0n, segments: traitsFor(l, a.segments) })),
    envelopes: w.envelopes.map((e) => ({ ...e, common: l.holdings.get(e.vault)?.melted ?? 0n, segments: traitsFor(l, e.segments) })),
  };
}

function envelopeView(l: Ledger, address: string) {
  const e = l.envelopes.get(address);
  if (!e) return null;
  const h = l.holdings.get(e.vault);
  const ranges = h?.ranges ?? [];
  return { ...e, ranges, common: h?.melted ?? 0n, segments: traitsFor(l, R.splitByStrike(ranges, l.config.strikeSize)) };
}

function strikesOf(l: Ledger, ranges: Range[]): Set<number> {
  return new Set(R.splitByStrike(ranges, l.config.strikeSize).map((s) => s.strike));
}

function touchesStrike(l: Ledger, ch: Change, n: number, envelopeStrikes: Map<string, Set<number>>): boolean {
  if ('ranges' in ch && ch.ranges.length) return strikesOf(l, ch.ranges).has(n);
  if ('envelope' in ch) return envelopeStrikes.get(ch.envelope)?.has(n) ?? false;
  return false;
}

function stats(l: Ledger) {
  let surviving = 0n;
  let sealed = 0n;
  const byRank = new Map<number, { rank: number; issued: bigint; surviving: bigint; strikes: number }>();
  for (const [account, h] of l.holdings) {
    const t = R.total(h.ranges);
    surviving += t;
    if (l.vaultToEnvelope.has(account)) sealed += t;
  }
  for (let n = 0; n < l.strikeCount; n++) {
    const s = l.strike(n);
    const rank = l.rank(n);
    const row = byRank.get(rank) ?? { rank, issued: 0n, surviving: 0n, strikes: 0 };
    row.issued += s.issued;
    row.surviving += s.surviving;
    row.strikes++;
    byRank.set(rank, row);
  }
  const envelopes = [...l.envelopes.values()];
  return {
    issued: l.curve.cursor,
    saleable: l.config.saleableSupply,
    surviving,
    melted: l.curve.cursor - surviving,
    sealed,
    envelopes: envelopes.length,
    listed: envelopes.filter((e) => e.status === 'listed').length,
    byRank: [...byRank.values()].sort((a, b) => b.rank - a.rank),
    revealed: !!l.reveal,
    lastSlot: l.lastSlot,
  };
}
