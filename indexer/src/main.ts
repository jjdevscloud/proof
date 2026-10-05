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
  pumpNonBuyInstructions: string[];
  vaultProgramId: string;
  revealAuthority: string;
  saleableSupply: string;
  strikeSize: string;
  revealFile?: string;
};

// Settings come from a JSON file (argv[2]); hosting-specific values can be overridden by
// environment variables so secrets (RPC_URL) never live in a committed file.
const config: Config = JSON.parse(readFileSync(process.argv[2] ?? 'config.json', 'utf8'));
const env = process.env;
if (env.RPC_URL) config.rpcUrl = env.RPC_URL;
if (env.PORT) config.port = Number(env.PORT);
if (env.DATA_DIR) config.dataDir = env.DATA_DIR;
if (env.REVEAL_FILE) config.revealFile = env.REVEAL_FILE;
const staticDir = env.STATIC_DIR || undefined;

// Pre-launch: no mint yet. The site is served with the rules, but nothing is indexed.
const pending = !config.mint || config.mint === 'PENDING';

// The rules shown on the site: the final committed file once it exists, else the template.
const rulesCandidates = [env.RULES_FILE, 'rules/sequents-v1.json', '../rules/sequents-v1.json', 'rules/sequents-v1.template.json', '../rules/sequents-v1.template.json'];
const rulesPath = rulesCandidates.find((p) => p && existsSync(p));
const rulesText = rulesPath ? readFileSync(rulesPath, 'utf8') : undefined;
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

const rpc = new Rpc(config.rpcUrl);

// Registers the reveal file once it exists, after checking its seed block against the chain:
// it must be the first block produced at or after the seed target slot, with that exact hash.
// Checked every cycle, so publishing the file needs no restart. A file that fails is not
// registered; if its reveal memo is posted anyway, the ledger halts (SPEC §4.4).
let registeredReveal: string | null = null;
async function registerRevealFile() {
  if (!config.revealFile || ledger.reveal || !existsSync(config.revealFile)) return;
  const bytes = readFileSync(config.revealFile);
  const { data, fileHash } = parseReveal(bytes);
  if (registeredReveal === fileHash) return;
  const first = await rpc.firstBlockFrom(data.seedTargetSlot);
  if (first?.slot !== data.seedSlot || first.blockhash !== data.blockhash) {
    console.error(`reveal file ${fileHash} NOT registered: seed block is slot ${first?.slot} hash ${first?.blockhash}`);
    return;
  }
  ledger.registerReveal(data, fileHash);
  registeredReveal = fileHash;
  console.log(`reveal file registered: ${fileHash}`);
}

const follower = new Follower(
  ledger,
  new Decoder(config),
  rpc,
  { ...config },
  syncedSlot,
);
// History for activity feeds and strike pages, rebuilt from the append-only change log.
const changesPath = join(config.dataDir, 'changes.jsonl');
const history: TxChanges[] = existsSync(changesPath)
  ? readFileSync(changesPath, 'utf8').split('\n').filter(Boolean).map(reviveChanges)
  : [];

// The log stores bigints as decimal strings; restore them.
function reviveChanges(line: string): TxChanges {
  const tx = JSON.parse(line);
  for (const ch of tx.changes) {
    if (ch.ranges) ch.ranges = ch.ranges.map((r: any) => ({ start: BigInt(r.start), end: BigInt(r.end) }));
    if (ch.price !== undefined) ch.price = BigInt(ch.price);
  }
  return tx;
}
const { server, broadcast } = createApi({
  ledger,
  syncedSlot: () => follower.syncedSlot,
  history,
  staticDir,
  previewDir: env.STATIC_PREVIEW_DIR || undefined,
  pending,
  rulesText,
  rpcUrl: env.PUBLIC_RPC_PROXY === 'off' ? undefined : config.rpcUrl,
  publicConfig: {
    mint: config.mint,
    vaultProgramId: config.vaultProgramId,
    curveTokenAccount: config.curveTokenAccount,
    curveProgramId: config.pumpProgramId,
    revealAuthority: config.revealAuthority,
  },
});
server.listen(config.port, () => console.log(`listening on :${config.port}${staticDir ? ' (website + /api + /rpc)' : ''}, synced to slot ${syncedSlot}`));

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
      await registerRevealFile();
      const n = await follower.syncOnce((c) => pending.push(c));
      // Persist changes and the snapshot only after the whole window applied cleanly.
      for (const c of pending) {
        if (c.changes.length) appendFileSync(changesPath, json(c) + '\n');
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
    // Only pause at the chain tip; while catching up, go straight to the next window.
    if (follower.syncedSlot >= follower.finalizedSlot) await new Promise((r) => setTimeout(r, config.pollMs));
  }
}
if (pending) console.log('pre-launch mode: no mint configured, indexing is off');
else loop();
