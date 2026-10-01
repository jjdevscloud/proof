// Read-only HTTP API over the ledger, plus a server-sent-events stream of changes.
import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import type { Ledger, TxChanges } from './ledger.ts';
import { leafHash, merkleProof } from './reveal.ts';

export type ApiState = { ledger: Ledger; syncedSlot: () => number };

export function json(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

export function createApi(state: ApiState): { server: Server; broadcast: (c: TxChanges) => void } {
  const streams = new Set<ServerResponse>();

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
        case 'wallet':
          return send(200, withTraits(l, l.wallet(need(parts[1]))));
        case 'strike': {
          const n = Number(parts[1]);
          if (!Number.isInteger(n) || n < 0 || n >= l.strikeCount) return send(404, { error: 'no such strike' });
          return send(200, { ...l.strike(n), traits: l.reveal?.strikes[n] ?? null });
        }
        case 'strikes':
          return send(200, Array.from({ length: l.strikeCount }, (_, n) => {
            const s = l.strike(n);
            return { strike: n, rank: l.rank(n), issued: s.issued, surviving: s.surviving };
          }));
        case 'envelopes': {
          const status = url.searchParams.get('status');
          const list = [...l.envelopes.values()].filter((e) => !status || e.status === status);
          return send(200, list.map((e) => ({ ...e, ranges: l.holdings.get(e.vault)?.ranges ?? [] })));
        }
        case 'envelope': {
          const e = l.envelopes.get(need(parts[1]));
          if (!e) return send(404, { error: 'no such envelope' });
          const h = l.holdings.get(e.vault);
          return send(200, { ...e, ranges: h?.ranges ?? [], common: h?.melted ?? 0n });
        }
        case 'preview': {
          const account = need(url.searchParams.get('account'));
          const amount = BigInt(need(url.searchParams.get('amount')));
          const bal = url.searchParams.get('balance');
          return send(200, l.preview(account, amount, bal === null ? undefined : BigInt(bal)));
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
    const msg = `data: ${json(c)}\n\n`;
    for (const s of streams) s.write(msg);
  };
  return { server, broadcast };
}

function need(v: string | null | undefined): string {
  if (!v) throw new Error('missing parameter');
  return v;
}

function withTraits(l: Ledger, w: ReturnType<Ledger['wallet']>) {
  const t = (seg: { strike: number }) => ({ ...seg, rank: l.rank(seg.strike), traits: l.reveal?.strikes[seg.strike].traits ?? null });
  return {
    accounts: w.accounts.map((a) => ({ ...a, segments: a.segments.map(t) })),
    envelopes: w.envelopes.map((e) => ({ ...e, segments: e.segments.map(t) })),
  };
}
