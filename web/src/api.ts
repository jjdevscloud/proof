// Typed client for the indexer API. All amounts/positions arrive as decimal strings.
import { useCallback, useEffect, useState } from 'react';

export const API_URL = import.meta.env.VITE_API_URL ?? '/api';

export type Segment = { start: string; end: string; strike: number; rank: number; traits: string[] | null };
export type RangeJson = { start: string; end: string };

export type Config = {
  mint: string;
  vaultProgramId: string;
  curveTokenAccount: string;
  curveProgramId: string;
  revealAuthority: string;
  strikeCount: number;
  strikeSize: string;
  saleableSupply: string;
  commitRoot: string | null;
  revealHash: string | null;
  revealed: boolean;
};

export type Health = { syncedSlot: number; lastSlot: number; fingerprint: string; revealed: boolean };

export type Stats = {
  issued: string;
  saleable: string;
  surviving: string;
  melted: string;
  sealed: string;
  envelopes: number;
  listed: number;
  byRank: { rank: number; issued: string; surviving: string; strikes: number }[];
  revealed: boolean;
  lastSlot: number;
};

export type StrikeRow = { strike: number; rank: number; traits: string[] | null; issued: string; surviving: string };

export type Envelope = {
  address: string;
  vault: string;
  holder: string;
  status: 'sealed' | 'listed';
  price: string;
  sealedSlot: number;
  ranges: RangeJson[];
  common: string;
  segments: Segment[];
};

export type WalletView = {
  accounts: { account: string; common: string; segments: Segment[] }[];
  envelopes: Envelope[];
};

export type Change =
  | { kind: 'issue'; account: string; ranges: RangeJson[] }
  | { kind: 'melt'; account: string; ranges: RangeJson[]; reason: string }
  | { kind: 'seal'; from: string; envelope: string; ranges: RangeJson[]; valid: boolean }
  | { kind: 'list'; envelope: string; price: string }
  | { kind: 'cancel'; envelope: string }
  | { kind: 'sale'; envelope: string; from: string; to: string; price: string }
  | { kind: 'gift'; envelope: string; from: string; to: string }
  | { kind: 'withdraw'; envelope: string; to: string }
  | { kind: 'commit'; root: string; deadlineSlot: number }
  | { kind: 'reveal'; fileHash: string };

export type TxChanges = { slot: number; signature: string; changes: Change[] };

export type StrikeDetail = {
  strike: number;
  size: string;
  issued: string;
  surviving: string;
  rank: number;
  traits: string[] | null;
  pieces: { account: string; envelope: string | null; holder: string | null; amount: string }[];
  history: TxChanges[];
};

export type Preview = { fromMelted: string; ranges: RangeJson[]; segments: Segment[] };
export type RevealStatus = {
  commitRoot: string | null;
  deadlineSlot: number | null;
  completionSlot: number | null;
  seedTargetSlot: number | null;
  seedFixed: boolean;
  eligibleStrikes: number | null;
  revealed: boolean;
  revealHash: string | null;
  // present once revealed
  rules?: string;
  seedSlot?: number;
  blockhash?: string;
};

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(API_URL + path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

// Bumped whenever the indexer streams a change, so every page refetches.
let version = 0;
const listeners = new Set<(v: number) => void>();
export function bumpVersion() {
  version++;
  for (const l of listeners) l(version);
}
export function useVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => {
    listeners.add(setV);
    return () => void listeners.delete(setV);
  }, []);
  return v;
}

export function useApi<T>(path: string | null): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const v = useVersion();
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    api<T>(path)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((e) => live && setState((s) => ({ data: s.data, error: (e as Error).message, loading: false })));
    return () => {
      live = false;
    };
  }, [path, v, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

// Live updates from the indexer's server-sent events.
export function subscribe(onChange: (c: TxChanges) => void): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    es = new EventSource(API_URL + '/stream');
    es.onmessage = (e) => onChange(JSON.parse(e.data));
    es.onerror = () => {
      es?.close();
      if (!closed) retry = setTimeout(open, 5000);
    };
  };
  open();
  return () => {
    closed = true;
    clearTimeout(retry);
    es?.close();
  };
}
