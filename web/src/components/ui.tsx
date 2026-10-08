import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Segment } from '../api.ts';
import { TIER_NAMES, explorer, fmtRange, fmtTokens, short, tier } from '../format.ts';
import { TraitIcon, coinCells } from './pixels.tsx';

// One full Strike in base units; segment coins show their share of it.
const STRIKE_BASE = 1_000_000_000_000n;

// The coin pixels, filled bottom-up in proportion to the share still surviving.
const COIN_PIXELS = coinCells(7, 5, 0)
  .map(([x, y]) => [x + 3, y + 2] as const)
  .sort((a, b) => b[1] - a[1] || a[0] - b[0]);

export function StrikeCoin({ strike, rank, size = 'md', part, whole }: {
  strike: number;
  rank: number;
  size?: 'sm' | 'md' | 'lg';
  part?: string | bigint;
  whole?: string | bigint;
}) {
  const gone = whole !== undefined && BigInt(whole) === 0n;
  const share = whole === undefined || part === undefined ? 1 : gone ? 0 : Number((BigInt(part) * 1000n) / BigInt(whole)) / 1000;
  const lit = Math.round(share * COIN_PIXELS.length);
  return (
    <a
      className={`coin coin-${size} t${tier(rank)}`}
      href={`#/strike/${strike}`}
      title={`Strike #${strike} · ${TIER_NAMES[tier(rank)]}${whole === undefined ? '' : ` · ${Math.round(share * 1000) / 10}% surviving`}`}
    >
      <svg className="coin-grid" viewBox="0 0 7 5" aria-hidden shapeRendering="crispEdges">
        {COIN_PIXELS.map(([x, y], i) => (
          <rect key={i} className={gone ? 'cc-out' : i < lit ? 'cc-on' : 'cc-off'} x={x + 0.07} y={y + 0.07} width={0.86} height={0.86} />
        ))}
      </svg>
      {size === 'sm' && <span className="coin-num">#{strike}</span>}
    </a>
  );
}

export function Traits({ traits, rank }: { traits: string[] | null; rank: number }) {
  if (!traits) return <span className="trait trait-pending">Unrevealed</span>;
  return (
    <span className="traits">
      {traits.map((t) => (
        <span key={t} className={`trait t${tier(rank)}`}><TraitIcon trait={t} />{t}</span>
      ))}
    </span>
  );
}

// One row per strike segment: coin, traits, token numbers, amount.
export function SegmentList({ segments, empty = 'Nothing rare here.' }: { segments: Segment[]; empty?: string }) {
  if (!segments.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="segments">
      {segments.map((s) => (
        <li key={s.start}>
          <StrikeCoin strike={s.strike} rank={s.rank} size="sm" part={BigInt(s.end) - BigInt(s.start)} whole={STRIKE_BASE} />
          <div className="seg-main">
            <Traits traits={s.traits} rank={s.rank} />
            <span className="mono small muted">{fmtRange(s.start, s.end)}</span>
          </div>
          <span className="mono seg-amt">{fmtTokens(BigInt(s.end) - BigInt(s.start))}</span>
        </li>
      ))}
    </ul>
  );
}

// Collapsible extra text behind a "+" toggle.
export function More({ children }: { children: ReactNode }) {
  return (
    <details className="more">
      <summary aria-label="More" />
      {children}
    </details>
  );
}

export function Addr({ value, href }: { value: string | null; href?: string }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <a className="mono addr" href={href ?? explorer('address', value)} target={href ? undefined : '_blank'} rel="noreferrer" title={value}>
      {short(value)}
    </a>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Bar({ value, tierClass = 't1' }: { value: number; tierClass?: string }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={`bar-fill ${tierClass}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Irreversible actions require typing a word.
export function TypedConfirm({ word, label, onConfirm, danger = true }: { word: string; label: string; onConfirm: () => void; danger?: boolean }) {
  const [text, setText] = useState('');
  return (
    <div className="typed-confirm">
      <label className="small">
        Type <strong className="mono">{word}</strong> to confirm
        <input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} disabled={text.trim().toUpperCase() !== word} onClick={onConfirm}>
        {label}
      </button>
    </div>
  );
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <p className="muted loading">{what}…</p>;
}

export function ErrorNote({ error }: { error: string }) {
  return <p className="error-note">{error}</p>;
}

// ---- transaction toasts ----

type Toast = { id: number; kind: 'pending' | 'ok' | 'error'; text: string; sig?: string };
let toasts: Toast[] = [];
let nextId = 1;
const toastSubs = new Set<() => void>();
const setToasts = (t: Toast[]) => {
  toasts = t;
  toastSubs.forEach((s) => s());
};

// Runs a transaction with pending/success/error feedback. Returns the signature or null.
export async function runTx(label: string, fn: () => Promise<string>): Promise<string | null> {
  const id = nextId++;
  setToasts([...toasts, { id, kind: 'pending', text: `${label}: waiting for your wallet…` }]);
  try {
    const sig = await fn();
    setToasts(toasts.map((t) => (t.id === id
      ? { id, kind: 'ok', sig, text: `${label}: confirmed. The ledger updates once the block is finalized (~20 s).` }
      : t)));
    setTimeout(() => setToasts(toasts.filter((t) => t.id !== id)), 15000);
    return sig;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    setToasts(toasts.map((t) => (t.id === id ? { id, kind: 'error', text: `${label}: ${msg}` } : t)));
    return null;
  }
}

export function Toasts() {
  const list = useSyncExternalStore(
    (cb) => {
      toastSubs.add(cb);
      return () => toastSubs.delete(cb);
    },
    () => toasts,
  );
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.text}</span>
          {t.sig && <a href={explorer('tx', t.sig)} target="_blank" rel="noreferrer">View</a>}
          {t.kind !== 'pending' && (
            <button className="icon-btn" onClick={() => setToasts(toasts.filter((x) => x.id !== t.id))} aria-label="Dismiss">×</button>
          )}
        </div>
      ))}
    </div>
  );
}
