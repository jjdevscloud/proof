// Minimal Solana JSON-RPC client (finalized commitment only).

export type SignatureInfo = { signature: string; slot: number; err: unknown };

export class Rpc {
  readonly url: string;
  private id = 0;

  constructor(url: string) {
    this.url = url;
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 10) {
        await new Promise((r) => setTimeout(r, Math.min(250 * 2 ** attempt, 16_000)));
        continue;
      }
      if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
      const body = (await res.json()) as { result?: T; error?: { message: string } };
      if (body.error) throw new Error(`${method}: ${body.error.message}`);
      return body.result as T;
    }
  }

  finalizedSlot(): Promise<number> {
    return this.call('getSlot', [{ commitment: 'finalized' }]);
  }

  // All successful-or-failed signatures touching `address` with fromSlot <= slot <= toSlot.
  async signatures(address: string, fromSlot: number, toSlot: number): Promise<SignatureInfo[]> {
    const out: SignatureInfo[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await this.call<SignatureInfo[]>('getSignaturesForAddress', [
        address, { limit: 1000, commitment: 'finalized', ...(before ? { before } : {}) },
      ]);
      for (const s of page) if (s.slot >= fromSlot && s.slot <= toSlot) out.push(s);
      if (page.length < 1000 || page[page.length - 1].slot < fromSlot) return out;
      before = page[page.length - 1].signature;
    }
  }

  transaction(signature: string): Promise<any> {
    return this.call('getTransaction', [
      signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 1 },
    ]);
  }

  // Token balance and owner of up to 100 token accounts (null where an account does not exist).
  async multipleTokenAccounts(addresses: string[]): Promise<({ amount: bigint; owner: string } | null)[]> {
    const res = await this.call<{ value: ({ data: any } | null)[] }>('getMultipleAccounts', [
      addresses, { encoding: 'jsonParsed', commitment: 'finalized' },
    ]);
    return res.value.map((a) => {
      const info = a?.data?.parsed?.info;
      return info?.tokenAmount ? { amount: BigInt(info.tokenAmount.amount), owner: info.owner } : null;
    });
  }

  // The first produced block at or after `slot` (slots can be skipped), with its hash.
  async firstBlockFrom(slot: number): Promise<{ slot: number; blockhash: string } | null> {
    const slots = await this.call<number[]>('getBlocks', [slot, slot + 500, { commitment: 'finalized' }]);
    if (!slots.length) return null;
    const block = await this.call<{ blockhash: string }>('getBlock', [
      slots[0], { transactionDetails: 'none', rewards: false, commitment: 'finalized', maxSupportedTransactionVersion: 1 },
    ]);
    return { slot: slots[0], blockhash: block.blockhash };
  }

  // Signatures of a block in execution order.
  async blockOrder(slot: number): Promise<string[]> {
    const block = await this.call<{ signatures: string[] }>('getBlock', [
      slot, { transactionDetails: 'signatures', rewards: false, commitment: 'finalized', maxSupportedTransactionVersion: 1 },
    ]);
    return block.signatures;
  }
}
