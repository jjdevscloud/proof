// Turns a `getTransaction(..., { encoding: 'jsonParsed' })` result into ledger events (SPEC §8.2).
import { decodeBase58, encodeBase58 as encodePubkey } from './base58.ts';
import { sha256 } from './reveal.ts';
import type { DecodedTx, LedgerEvent, Observation } from './ledger.ts';
import type { Range } from './ranges.ts';

export type DecoderConfig = {
  mint: string;
  curveTokenAccount: string;
  pumpProgramId: string;
  // Anchor names of pump.fun instructions that move tokens out of the curve WITHOUT selling them
  // (migration). Any other pump.fun instruction moving tokens out of the curve is a buy, so new buy
  // variants (buy_v2, buy_exact_quote_in_v2, ...) are covered without a config change. SPEC §3.2.
  pumpNonBuyInstructions: string[];
  vaultProgramId: string;
  revealAuthority: string;
  rollTreasury?: string; // system transfers to it are reported, for roll fees (SPEC §4.5)
};

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';

export const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);
export const MEMO_PROGRAMS = new Set([
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
]);

export class DecodeError extends Error {}

export function anchorDiscriminator(name: string): string {
  return sha256(`global:${name}`).subarray(0, 8).toString('hex');
}

type Ix = {
  programId: string;
  parsed?: any;
  accounts?: string[];
  data?: string;
  stackHeight?: number | null;
};

type VaultIx =
  | { name: 'seal'; accounts: string[]; ranges: Range[] }
  | { name: 'list'; accounts: string[]; price: bigint }
  | { name: 'buy' | 'cancel' | 'withdraw' | 'initialize'; accounts: string[] }
  | { name: 'gift'; accounts: string[]; newHolder: string };

export class Decoder {
  readonly config: DecoderConfig;
  private pumpNonBuy: Set<string>;
  private vaultNames: Map<string, string>;

  constructor(config: DecoderConfig) {
    this.config = config;
    this.pumpNonBuy = new Set(config.pumpNonBuyInstructions.map(anchorDiscriminator));
    this.vaultNames = new Map(
      ['initialize', 'seal', 'list', 'cancel', 'buy', 'gift', 'withdraw'].map((n) => [anchorDiscriminator(n), n]),
    );
  }

  // Returns null for failed transactions.
  decode(tx: any): DecodedTx | null {
    if (!tx?.meta) throw new DecodeError('transaction has no meta');
    if (tx.meta.err) return null;
    const signature: string = tx.transaction.signatures[0];
    const keys = accountKeys(tx);
    const signers = new Set(keys.filter((k) => k.signer).map((k) => k.pubkey));
    const pre = this.observations(tx.meta.preTokenBalances, keys);
    const post = this.observations(tx.meta.postTokenBalances, keys);
    const ours = new Set([...pre, ...post].map((o) => o.account));

    const events: LedgerEvent[] = [];
    for (const { ix, parent } of executionOrder(tx)) {
      if (TOKEN_PROGRAMS.has(ix.programId) && ix.parsed) {
        const ev = this.tokenEvent(ix, parent, ours);
        if (ev) events.push(ev);
      } else if (ix.programId === this.config.vaultProgramId) {
        const ev = this.vaultEvent(ix);
        if (ev) events.push(ev);
      } else if (MEMO_PROGRAMS.has(ix.programId)) {
        const text = typeof ix.parsed === 'string' ? ix.parsed : '';
        const ev = signers.has(this.config.revealAuthority) ? memoEvent(text) : null;
        if (ev) events.push(ev);
        else {
          const roll = /^proof:v1:roll:([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(text.trim());
          if (roll) events.push({ kind: 'roll', envelope: roll[1] });
        }
      } else if (ix.programId === SYSTEM_PROGRAM && this.config.rollTreasury && ix.parsed?.type === 'transfer'
          && ix.parsed.info.destination === this.config.rollTreasury) {
        events.push({ kind: 'lamports', from: ix.parsed.info.source, to: ix.parsed.info.destination, lamports: BigInt(ix.parsed.info.lamports) });
      }
    }
    return { slot: tx.slot, signature, pre, post, events };
  }

  private observations(balances: any[] | undefined, keys: { pubkey: string }[]): Observation[] {
    return (balances ?? [])
      .filter((b) => b.mint === this.config.mint)
      .map((b) => ({ account: keys[b.accountIndex].pubkey, owner: b.owner, balance: BigInt(b.uiTokenAmount.amount) }));
  }

  private tokenEvent(ix: Ix, parent: Ix | null, ours: Set<string>): LedgerEvent | null {
    const { type, info } = ix.parsed;
    switch (type) {
      case 'transfer':
      case 'transferChecked': {
        if (info.mint !== undefined && info.mint !== this.config.mint) return null;
        if (!ours.has(info.source) && !ours.has(info.destination)) return null;
        const amount = BigInt(info.amount ?? info.tokenAmount.amount);
        const from: string = info.source;
        const to: string = info.destination;
        if (parent && from === this.config.curveTokenAccount && parent.programId === this.config.pumpProgramId
            && !this.pumpNonBuy.has(discriminatorOf(parent))) {
          return { kind: 'curveBuy', to, amount };
        }
        if (parent && parent.programId === this.config.vaultProgramId) {
          const v = this.decodeVault(parent);
          if (v?.name === 'seal' && from === v.accounts[4] && to === v.accounts[3]) {
            return { kind: 'seal', from, holder: v.accounts[0], envelope: v.accounts[2], vault: v.accounts[3], ranges: v.ranges, amount };
          }
          if (v?.name === 'withdraw' && from === v.accounts[2]) {
            return { kind: 'withdraw', envelope: v.accounts[1], to, amount };
          }
        }
        return { kind: 'transfer', from, to, amount };
      }
      case 'burn':
      case 'burnChecked':
        if (!ours.has(info.account)) return null;
        return { kind: 'burn', from: info.account, amount: BigInt(info.amount ?? info.tokenAmount.amount) };
      case 'setAuthority':
        if (info.authorityType !== 'accountOwner' || !ours.has(info.account)) return null;
        return { kind: 'ownerChange', account: info.account, newOwner: info.newAuthority };
      default:
        return null;
    }
  }

  // Seal and withdraw are emitted at their token transfer; the rest have no token movement.
  private vaultEvent(ix: Ix): LedgerEvent | null {
    const v = this.decodeVault(ix);
    if (!v) return null;
    switch (v.name) {
      case 'list': return { kind: 'list', envelope: v.accounts[1], price: v.price };
      case 'cancel': return { kind: 'cancel', envelope: v.accounts[1] };
      case 'buy': return { kind: 'sale', envelope: v.accounts[2], buyer: v.accounts[0] };
      case 'gift': return { kind: 'gift', envelope: v.accounts[1], to: v.newHolder };
      default: return null;
    }
  }

  private decodeVault(ix: Ix): VaultIx | null {
    if (!ix.data || !ix.accounts) return null;
    const data = decodeBase58(ix.data);
    const name = this.vaultNames.get(Buffer.from(data.subarray(0, 8)).toString('hex'));
    if (!name) return null;
    const r = new Reader(data, 8);
    const accounts = ix.accounts;
    switch (name) {
      case 'seal': {
        const n = r.u32();
        const ranges: Range[] = [];
        for (let i = 0; i < n; i++) {
          const start = r.u64();
          ranges.push({ start, end: start + r.u64() });
        }
        return { name, accounts, ranges };
      }
      case 'list': return { name, accounts, price: r.u64() };
      case 'gift': return { name, accounts, newHolder: r.pubkey() };
      case 'buy': case 'cancel': case 'withdraw': case 'initialize': return { name, accounts };
      default: return null;
    }
  }
}

function memoEvent(text: string): LedgerEvent | null {
  // proof:v1:commit:<sha256 of rules file>:<deadline slot>   |   proof:v1:reveal:<sha256 of reveal file>
  const c = /^proof:v1:commit:([0-9a-f]{64}):([0-9]{1,15})$/.exec(text.trim());
  if (c) return { kind: 'commit', root: c[1], deadlineSlot: Number(c[2]) };
  const r = /^proof:v1:reveal:([0-9a-f]{64})$/.exec(text.trim());
  return r ? { kind: 'reveal', fileHash: r[1] } : null;
}

function discriminatorOf(ix: Ix): string {
  if (!ix.data) return '';
  return Buffer.from(decodeBase58(ix.data).subarray(0, 8)).toString('hex');
}

function accountKeys(tx: any): { pubkey: string; signer: boolean }[] {
  const keys = tx.transaction.message.accountKeys.map((k: any) =>
    typeof k === 'string' ? { pubkey: k, signer: false, source: undefined } : k,
  );
  // jsonParsed normally includes lookup-table keys (source: "lookupTable"); fall back if not.
  const loaded = tx.meta.loadedAddresses;
  if (loaded && !keys.some((k: any) => k.source === 'lookupTable')) {
    for (const pubkey of [...(loaded.writable ?? []), ...(loaded.readonly ?? [])]) keys.push({ pubkey, signer: false });
  }
  return keys;
}

// Top-level instructions each followed by their inner instructions, with each one's direct parent.
export function executionOrder(tx: any): { ix: Ix; parent: Ix | null }[] {
  const out: { ix: Ix; parent: Ix | null }[] = [];
  const inner = new Map<number, Ix[]>();
  for (const group of tx.meta.innerInstructions ?? []) inner.set(group.index, group.instructions);
  tx.transaction.message.instructions.forEach((top: Ix, i: number) => {
    out.push({ ix: top, parent: null });
    const stack: Ix[] = [top];
    for (const ix of inner.get(i) ?? []) {
      const height = ix.stackHeight ?? 2;
      stack.length = Math.max(1, height - 1);
      out.push({ ix, parent: stack[stack.length - 1] });
      stack.push(ix);
    }
  });
  return out;
}

class Reader {
  private view: DataView;
  private bytes: Uint8Array;
  private off: number;
  constructor(bytes: Uint8Array, off: number) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.off = off;
  }
  u32(): number {
    const v = this.view.getUint32(this.off, true);
    this.off += 4;
    return v;
  }
  u64(): bigint {
    const v = this.view.getBigUint64(this.off, true);
    this.off += 8;
    return v;
  }
  pubkey(): string {
    const b = this.bytes.subarray(this.off, this.off + 32);
    this.off += 32;
    return encodePubkey(b);
  }
}
