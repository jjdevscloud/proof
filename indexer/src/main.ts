// Entry point: node src/main.ts [config.json]
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ledger, LedgerError } from './ledger.ts';
import type { TxChanges } from './ledger.ts';
import { Decoder } from './decoder.ts';
import { Follower } from './follower.ts';
import { Rpc } from './rpc.ts';
import { createApi, json } from './api.ts';
import type { ApiState } from './api.ts';
import { buildRevealBytes, parseReveal, sha256 } from './reveal.ts';
import { checkLaunch, findMintRecord } from './launch.ts';
import { parseRules } from './derive.ts';

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
  treasury?: string;
  feeBps?: number;
  watchMint?: boolean; // also fetch every transaction naming the mint (heavy once an AMM trades it)
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

// Pre-launch: no mint yet. The site is served with the rules, but nothing is indexed until the
// launch authority records the mint in the vault program (see launch.ts); then this goes live.
const pending = !config.mint || config.mint === 'PENDING';

// The rules shown on the site: the final committed file once it exists, else the template.
const rulesCandidates = [env.RULES_FILE, 'rules/sequents-v1.json', '../rules/sequents-v1.json', 'rules/sequents-v1.template.json', '../rules/sequents-v1.template.json'];
const rulesPath = rulesCandidates.find((p) => p && existsSync(p));
const rulesText = rulesPath ? readFileSync(rulesPath, 'utf8') : undefined;
// The roll (SPEC §4.5) runs from launch, so the indexer applies the roll section of these rules;
// at the reveal the ledger checks it equals the committed one.
const rollRules = rulesText ? JSON.parse(rulesText).roll : undefined;
if (rollRules) parseRules(JSON.stringify({ ...JSON.parse(rulesText!), deadlineSlot: 1 }));
mkdirSync(config.dataDir, { recursive: true });
const snapshotPath = join(config.dataDir, 'snapshot.json');
const ledgerConfig = () => ({
  curveTokenAccount: config.curveTokenAccount,
  saleableSupply: BigInt(config.saleableSupply),
  strikeSize: BigInt(config.strikeSize),
  roll: rollRules,
});

// Before launch this is an empty placeholder ledger; start() replaces it.
let ledger = new Ledger(ledgerConfig());
let syncedSlot = config.startSlot;
function loadLedger() {
  if (existsSync(snapshotPath)) {
    const snap = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    ledger = Ledger.fromJSON(ledgerConfig(), snap.ledger);
    syncedSlot = snap.syncedSlot;
  } else {
    ledger = new Ledger(ledgerConfig());
  }
}

const rpc = new Rpc(config.rpcUrl);

// Registers the reveal file once it exists, after checking its seed block against the chain:
// it must be the first block produced at or after the seed target slot, with that exact hash.
// Checked every cycle, so publishing the file needs no restart. A file that fails is not
// registered; if its reveal memo is posted anyway, the ledger halts (SPEC §4.4).
let registeredReveal: string | null = null;
async function registerRevealFile() {
  if (ledger.reveal) return;
  await buildRevealFromChain();
  if (!config.revealFile || !existsSync(config.revealFile)) return;
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

// Once the seed point is fixed, the reveal file follows from public data alone (the committed rules,
// the seed block, the number of fully sold Strikes): build and register it, so the reveal memo can
// be posted right away with no file to upload. ops/make-reveal.ts builds the identical file.
async function buildRevealFromChain() {
  if (registeredReveal || !rulesText || ledger.seedFixedAt === null || ledger.commitRoot !== sha256(rulesText).toString('hex')) return;
  const first = await rpc.firstBlockFrom(ledger.seedFixedAt);
  if (!first) return;
  const bytes = buildRevealBytes(rulesText, ledger.seedFixedAt, first.slot, first.blockhash, ledger.eligibleStrikes()!);
  const { data, fileHash } = parseReveal(bytes);
  ledger.registerReveal(data, fileHash);
  registeredReveal = fileHash;
  writeFileSync(join(config.dataDir, 'reveal-built.json'), bytes);
  console.log(`reveal file built from the seed block (slot ${first.slot}) and registered: ${fileHash}`);
}

let follower: Follower | null = null;
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
    if (ch.ordinary !== undefined) ch.ordinary = BigInt(ch.ordinary);
  }
  return tx;
}
const apiState: ApiState = {
  ledger,
  syncedSlot: () => follower?.syncedSlot ?? syncedSlot,
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
    treasury: config.treasury ?? 'hWZ3MZHKNvjP69DRSwX8WQqaPYa4tNdJVvTjNn5ixWb',
    feeBps: config.feeBps ?? 150,
    revealAuthority: config.revealAuthority,
  },
};
const { server, broadcast } = createApi(apiState);
server.listen(config.port, () => console.log(`listening on :${config.port}${staticDir ? ' (website + /api + /rpc)' : ''}, synced to slot ${syncedSlot}`));

function saveSnapshot() {
  const tmp = snapshotPath + '.tmp';
  writeFileSync(tmp, json({ syncedSlot: follower!.syncedSlot, ledger: ledger.toJSON() }));
  renameSync(tmp, snapshotPath);
}

let lastFingerprintSlot = syncedSlot;
async function loop() {
  const follower = start();
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
// Builds the ledger and follower for the configured mint and switches the API to live.
function start(): Follower {
  loadLedger();
  lastFingerprintSlot = syncedSlot;
  const rollTreasury = rollRules?.treasury;
  // The mint is watched only on request (watchMint): once trading moves to an AMM every trade names
  // the mint, and fetching them all outruns the RPC. Holders that move are found by the batched
  // balance check instead, which costs one request per 100 holders whatever the trading volume.
  const f = new Follower(ledger, new Decoder({ ...config, rollTreasury }), rpc, { ...config, rollTreasury, mint: config.watchMint ? config.mint : undefined }, syncedSlot);
  follower = f;
  apiState.ledger = ledger;
  apiState.publicConfig.mint = config.mint;
  apiState.publicConfig.curveTokenAccount = config.curveTokenAccount;
  apiState.pending = false;
  return f;
}

// Pre-launch: poll the vault program for the mint record. When it appears and the token passes
// the checks, go live in place (no restart, no new config). History from the commit slot onwards
// is indexed, so the moments between token creation and going live are not lost.
async function awaitLaunch() {
  console.log('pre-launch mode: waiting for the mint to be recorded in the vault program');
  // Checked once, at launch: later (e.g. after the curve migrates) the curve-balance check no longer
  // applies, so a restart reuses the launch that already passed.
  const launchPath = join(config.dataDir, 'launch.json');
  if (existsSync(launchPath)) {
    Object.assign(config, JSON.parse(readFileSync(launchPath, 'utf8')));
    console.log(`launched earlier: mint ${config.mint}`);
    return loop();
  }
  let lastReport = '';
  for (;;) {
    try {
      const launch = await findMintRecord(rpc, config.vaultProgramId);
      if (launch) {
        const failures = config.startSlot > 0
          ? await checkLaunch(rpc, launch, config.pumpProgramId, BigInt(config.saleableSupply))
          : ['startSlot is not set (run make-commit --post and deploy before creating the token)'];
        if (!failures.length) {
          config.mint = launch.mint;
          config.curveTokenAccount = launch.curveTokenAccount;
          writeFileSync(launchPath, JSON.stringify(launch));
          console.log(`LAUNCH: mint ${launch.mint}, curve token account ${launch.curveTokenAccount}; going live`);
          return loop();
        }
        const report = failures.join('; ');
        if (report !== lastReport) console.error(`LAUNCH BLOCKED for mint ${launch.mint}: ${report}`);
        lastReport = report;
      }
    } catch (e) {
      console.error(`launch check failed, retrying: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, config.pollMs));
  }
}

if (pending) awaitLaunch();
else loop();
