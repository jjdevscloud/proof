// Read-only HTTP API over the ledger, plus a server-sent-events stream of changes. In production it
// also serves the built website and a restricted Solana RPC proxy, so the RPC key never reaches
// browsers and the site, API and RPC share one origin.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { Change, Ledger, TxChanges } from './ledger.ts';
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
  staticDir?: string; // built website (web/dist); when set, the API lives under /api
  previewDir?: string; // demo-data build of every page (web/dist-preview), served at /preview
  rpcUrl?: string; // upstream Solana RPC for the /rpc proxy (kept server-side)
  pending?: boolean; // pre-launch: no mint yet, nothing indexed
  rulesText?: string; // the rarity rules (committed file, or the template before launch)
};

const API_ROUTES = new Set(['health', 'config', 'rules', 'stats', 'wallet', 'strike', 'strikes', 'envelopes', 'envelope', 'activity', 'preview', 'reveal', 'stream']);

// What the website needs from Solana, and nothing heavier: no transaction-history or full-block queries.
const RPC_METHODS = new Set([
  'getLatestBlockhash', 'getAccountInfo', 'getMultipleAccounts', 'getBalance', 'getMinimumBalanceForRentExemption',
  'sendTransaction', 'simulateTransaction', 'getSignatureStatuses', 'getBlocks', 'getBlock', 'getSlot', 'getBlockHeight',
]);
const RPC_PER_MINUTE = 300;

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

  const rpcHits = new Map<string, { minute: number; count: number }>();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/rpc') return void proxyRpc(req, res, state.rpcUrl, rpcHits);
    if (state.previewDir && (url.pathname === '/preview' || url.pathname.startsWith('/preview/'))) {
      if (url.pathname === '/preview') {
        res.writeHead(301, { location: '/preview/' }).end();
        return;
      }
      return void serveStatic(res, state.previewDir, url.pathname.slice('/preview'.length));
    }
    if (parts[0] === 'api') parts = parts.slice(1);
    else if (state.staticDir && !API_ROUTES.has(parts[0] ?? '')) return void serveStatic(res, state.staticDir, url.pathname);
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
            pending: !!state.pending,
          });
        case 'rules': {
          if (!state.rulesText) return send(404, { error: 'rules not available' });
          const rules = JSON.parse(state.rulesText);
          return send(200, { final: rules.deadlineSlot > 0, rules });
        }
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
        case 'reveal': {
          // Seed status before the reveal; afterwards everything a browser needs to recompute every
          // Strike's traits from the committed rules and the public seed block (SPEC §4).
          const status = {
            commitRoot: l.commitRoot,
            deadlineSlot: l.deadlineSlot,
            completionSlot: l.completionSlot,
            seedTargetSlot: l.seedFixedAt ?? l.seedTarget(),
            seedFixed: l.seedFixedAt !== null,
            eligibleStrikes: l.eligibleStrikes(),
            revealed: !!l.reveal,
            revealHash: l.revealHash,
          };
          if (!l.reveal) return send(200, status);
          const { rules, seedSlot, blockhash } = l.reveal;
          return send(200, { ...status, rules, seedSlot, blockhash });
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

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

async function serveStatic(res: ServerResponse, dir: string, pathname: string) {
  const root = normalize(dir);
  let file = normalize(join(root, decodeURIComponent(pathname)));
  if (!file.startsWith(root + sep) && file !== root) {
    res.writeHead(400).end();
    return;
  }
  if (file === root || pathname.endsWith('/')) file = join(root, 'index.html');
  try {
    const body = await readFile(file);
    const immutable = pathname.startsWith('/assets/');
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch {
    // Unknown paths get the app (hash routing handles the rest).
    const index = await readFile(join(root, 'index.html')).catch(() => null);
    res.writeHead(index ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(index ?? 'not found');
  }
}

async function proxyRpc(req: IncomingMessage, res: ServerResponse, upstream: string | undefined, hits: Map<string, { minute: number; count: number }>) {
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!upstream) return reply(404, { error: 'rpc proxy not configured' });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  const minute = Math.floor(Date.now() / 60000);
  const h = hits.get(ip);
  if (!h || h.minute !== minute) hits.set(ip, { minute, count: 1 });
  else if (++h.count > RPC_PER_MINUTE) return reply(429, { error: 'rate limited' });
  if (hits.size > 10000) hits.clear();

  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 65536) return reply(413, { error: 'request too large' });
  }
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: 'invalid JSON' });
  }
  if (Array.isArray(body) || !RPC_METHODS.has(body?.method)) {
    return reply(403, { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32601, message: 'method not allowed by this proxy' } });
  }
  if (body.method === 'getBlock' && body.params?.[1]?.transactionDetails !== 'none') {
    return reply(403, { jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'getBlock is limited to transactionDetails: none' } });
  }
  try {
    const upstreamRes = await fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
    res.writeHead(upstreamRes.status, { 'content-type': 'application/json' });
    res.end(await upstreamRes.text());
  } catch {
    reply(502, { error: 'upstream RPC unavailable' });
  }
}
