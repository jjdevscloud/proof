// Entry point: node src/main.ts [config.json]
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ledger, LedgerError } from './ledger.ts';
import type { TxChanges } from './ledger.ts';
import { Decoder } from './decoder.ts';
import { Follower } from './follower.ts';
import { Rpc } from './rpc.ts';
import { createApi, json } from './api.ts';
import { parseReveal } from './reveal.ts';

type Config = {
  rpcUrl: string;
  dataDir: string;
  port: number;
  pollMs: number;
  maxWindowSlots: number;
  startSlot: number; // slot before the commit memo; indexing starts after it
  fingerprintEverySlots: number;
  mint: string;
  curveTokenAccount: string;
  pumpProgramId: string;
  pumpBuyInstructions: string[];
  vaultProgramId: string;
  revealAuthority: string;
  saleableSupply: string;
  strikeSize: string;
  revealFile?: string;
};

const config: Config = JSON.parse(readFileSync(process.argv[2] ?? 'config.json', 'utf8'));
mkdirSync(config.dataDir, { recursive: true });
const snapshotPath = join(config.dataDir, 'snapshot.json');
const ledgerConfig = {
  curveTokenAccount: config.curveTokenAccount,
  saleableSupply: BigInt(config.saleableSupply),
  strikeSize: BigInt(config.strikeSize),
};

let ledger: Ledger;
let syncedSlot = config.startSlot;
if (existsSync(snapshotPath)) {
  const snap = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  ledger = Ledger.fromJSON(ledgerConfig, snap.ledger);
  syncedSlot = snap.syncedSlot;
} else {
  ledger = new Ledger(ledgerConfig);
}

if (config.revealFile && existsSync(config.revealFile)) {
  const { data, fileHash } = parseReveal(readFileSync(config.revealFile), ledger.strikeCount);
  ledger.registerReveal(data, fileHash);
  console.log(`reveal file registered: ${fileHash}`);
}

const follower = new Follower(
  ledger,
  new Decoder(config),
  new Rpc(config.rpcUrl),
  { ...config },
  syncedSlot,
);
const { server, broadcast } = createApi({ ledger, syncedSlot: () => follower.syncedSlot });
server.listen(config.port, () => console.log(`api on :${config.port}, synced to slot ${syncedSlot}`));

function saveSnapshot() {
  const tmp = snapshotPath + '.tmp';
  writeFileSync(tmp, json({ syncedSlot: follower.syncedSlot, ledger: ledger.toJSON() }));
  renameSync(tmp, snapshotPath);
}

let lastFingerprintSlot = syncedSlot;
async function loop() {
  for (;;) {
    const pending: TxChanges[] = [];
    try {
      const n = await follower.syncOnce((c) => pending.push(c));
      // Persist changes and the snapshot only after the whole window applied cleanly.
      for (const c of pending) {
        if (c.changes.length) appendFileSync(join(config.dataDir, 'changes.jsonl'), json(c) + '\n');
      }
      saveSnapshot();
      for (const c of pending) broadcast(c);
      if (follower.syncedSlot - lastFingerprintSlot >= config.fingerprintEverySlots) {
        appendFileSync(join(config.dataDir, 'fingerprints.jsonl'), json({ slot: follower.syncedSlot, fingerprint: ledger.fingerprint() }) + '\n');
        lastFingerprintSlot = follower.syncedSlot;
      }
      if (n) console.log(`slot ${follower.syncedSlot}: ${n} txs`);
    } catch (e) {
      // A window may have been partly applied in memory, so never retry in-process. The
      // on-disk snapshot is the last consistent state; a supervisor restarts from it.
      if (e instanceof LedgerError) console.error(`HALT (ledger inconsistency, needs a human): ${e.message}`);
      else console.error(`sync error, exiting for restart: ${(e as Error).message}`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, config.pollMs));
  }
}
loop();
