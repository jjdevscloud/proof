import { useConfig } from '../App.tsx';
import { Addr, More } from '../components/ui.tsx';

// Deterministic PRNG so the diagrams render identically every time.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 1831565813) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function NumberingDiagram() {
  const ruler = (n: number) => 20 + (n * 480) / 793;
  const dot = (n: number) => 20 + n * 20;
  return (
    <svg className="gfx" viewBox="0 0 520 170" aria-hidden>
      <line x1={20} y1={30} x2={500} y2={30} />
      {Array.from({ length: 33 }, (_, i) => i * 25).map((n) => (
        <line key={n} x1={ruler(n)} y1={30} x2={ruler(n)} y2={n % 100 == 0 ? 22 : 26} />
      ))}
      <text x={20} y={14}>0</text>
      <text x={500} y={14} textAnchor="end">793</text>
      <rect className="fill-ink" x={496.5} y={26.5} width={7} height={7} />
      <path className="dash" d={`M20 36 V104 M${ruler(24)} 36 L500 104`} />
      <line x1={20} y1={110} x2={500} y2={110} />
      {Array.from({ length: 25 }, (_, n) => (n < 5
        ? <circle key={n} className="fill-acc" cx={dot(n)} cy={110} r={5.5} />
        : <circle key={n} className="fill-bg" cx={dot(n)} cy={110} r={3.5} />))}
      <text x={dot(0)} y={134} textAnchor="middle">0</text>
      <text x={dot(4)} y={134} textAnchor="middle">4</text>
      <text x={dot(5)} y={134} textAnchor="middle">5</text>
      <text x={dot(24)} y={134} textAnchor="middle">24</text>
      <path d={`M${dot(0)} 146 V152 H${dot(4)} V146 M${dot(5)} 146 V152 H${dot(24)} V146`} />
    </svg>
  );
}

function TwoPlacesDiagram() {
  const rand = seeded(11);
  const melt = Array.from({ length: 46 }, () => ({ x: 380 + rand() * 120, y: 86 + (rand() - 0.5) * (12 + rand() * 40) }));
  return (
    <svg className="gfx" viewBox="0 0 520 200" aria-hidden>
      <rect className="fill-ink" x={34} y={92} width={16} height={16} />
      <path d="M50 100 H170 M170 100 V50 H286 M170 100 V150 H286" />
      <path className="dash" d="M170 100 H372" />
      <circle className="fill-bg" cx={170} cy={100} r={3} />
      <circle className="fill-acc" cx={300} cy={50} r={14} />
      <circle className="fill-bg" cx={300} cy={150} r={14} />
      <text x={300} y={54} textAnchor="middle">01</text>
      <text x={300} y={154} textAnchor="middle">02</text>
      <path d="M314 50 H380 M314 150 H380" />
      <circle className="fill-bg" cx={384} cy={50} r={4} />
      <circle className="fill-bg" cx={384} cy={150} r={4} />
      {melt.map((m, i) => <rect key={i} className="fill-melt" x={m.x} y={m.y} width={4} height={4} />)}
    </svg>
  );
}

function MeltOrderDiagram() {
  const pts = [[40, 30], [110, 30], [110, 62], [190, 62], [190, 88], [270, 88], [270, 120], [360, 120], [360, 134], [470, 134]];
  return (
    <svg className="gfx" viewBox="0 0 520 170" aria-hidden>
      <path d="M14 10 V22 M14 10 H26 M506 10 V22 M506 10 H494 M14 160 V148 M14 160 H26 M506 160 V148 M506 160 H494" />
      {['05', '04', '03', '02', '01'].map((label, i) => <text key={label} x={30} y={34 + i * 26} textAnchor="end">{label}</text>)}
      <path className="dash" d="M40 146 H480" />
      <polyline points={pts.map((p) => p.join(',')).join(' ')} />
      {pts.filter((_, i) => i % 2 == 0).map(([x, y]) => <circle key={`${x}${y}`} className="fill-bg" cx={x} cy={y} r={3.5} />)}
      {pts.filter((_, i) => i % 2 == 1).map(([x, y]) => <rect key={`${x}${y}`} className="fill-ink" x={x - 3} y={y - 3} width={6} height={6} />)}
    </svg>
  );
}

function SaleDiagram() {
  return (
    <svg className="gfx" viewBox="0 0 520 170" aria-hidden>
      <path d="M80 92 V40 Q80 28 92 28 H428 Q440 28 440 40 V92" />
      <path className="fill-ink" d="M98 23 L88 28 L98 33 Z" />
      <circle className="fill-bg" cx={80} cy={110} r={18} />
      <circle className="fill-bg" cx={440} cy={110} r={18} />
      <text x={80} y={114} textAnchor="middle">a</text>
      <text x={440} y={114} textAnchor="middle">b</text>
      <path className="dash" d="M260 28 V96" />
      <rect className="fill-acc" x={246} y={96} width={28} height={28} />
      <path d="M98 110 H230 M290 110 H422" className="dash" />
      {[160, 200, 320, 360].map((x) => <line key={x} x1={x} y1={22} x2={x} y2={34} />)}
      <path d="M230 150 H290 M230 146 V154 M290 146 V154" />
    </svg>
  );
}

function FloorDiagram() {
  const wave = Array.from({ length: 121 }, (_, i) => {
    const x = 40 + i * 3.67;
    const y = 70 - Math.sin(i / 6) * 22 - Math.sin(i / 17) * 10;
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="gfx" viewBox="0 0 520 150" aria-hidden>
      <path d={wave} />
      <path className="dash" d="M40 116 H480" />
      <path className="fill-ink" d="M28 116 L40 110 L40 122 Z M492 116 L480 110 L480 122 Z" />
      {Array.from({ length: 45 }, (_, i) => <line key={i} x1={40 + i * 10} y1={128} x2={40 + i * 10} y2={i % 5 ? 132 : 136} />)}
    </svg>
  );
}

export function Rules() {
  const config = useConfig();
  return (
    <article className="prose">
      <p className="eyebrow">How Sequents works</p>
      <h1>Same coin. Two markets.</h1>
      <More>
        <p className="lede">
          A 1964 silver quarter spends as 25 cents at a shop, but a coin dealer pays far more for it — because collectors care
          <em> which</em> quarter it is. Sequents brings that to $PROOF. Jupiter is the shop. The collector desk is the dealer.
        </p>
      </More>

      <div className="works">
        <section className="work">
          <h2>1. Every token has a number</h2>
          <NumberingDiagram />
          <More>
            <p>
              Tokens are numbered in the order they're bought off the bonding curve. Each block of 1,000,000 is a <strong>Strike</strong>.
              Some Strikes are rare. Position-based tiers (Genesis, Key Date) go to the earliest Strikes; random errors (Double Die and
              others) are assigned after the sale from a public Solana block, so nobody can know them in advance. The rules are
              committed on-chain before the first buy, and anyone can verify any Strike from its page.
            </p>
          </More>
        </section>

        <section className="work">
          <h2>2. Rarity lives in two places only</h2>
          <TwoPlacesDiagram />
          <More>
            <ul>
              <li><strong>The account that bought it off the curve.</strong> Your original purchase keeps its numbers.</li>
              <li><strong>A sealed envelope.</strong> A vault account controlled by the Sequents program, holding exactly the tokens you sealed.</li>
            </ul>
          </More>
        </section>

        <section className="work">
          <h2>3. Anything that leaves, melts</h2>
          <MeltOrderDiagram />
          <More>
            <p>
              Sell on Jupiter, send to a friend, sell back to the curve, change the account's owner, or withdraw from an envelope —
              the tokens that leave become ordinary $PROOF, permanently. Melted tokens are never rare again, so every melt makes the
              survivors scarcer.
            </p>
            <div className="callout">
              <strong>Selling some, keeping your rare ones:</strong> when tokens leave an origin account, ordinary tokens go first,
              then the least rare. Use “What melts if I sell?” on your wallet page before you trade.
            </div>
          </More>
        </section>

        <section className="work">
          <h2>4. Selling rarity without melting it</h2>
          <SaleDiagram />
          <More>
            <p>
              Seal rare tokens into an envelope and list it on the desk. A buyer pays you and becomes the envelope's holder in one
              transaction — the tokens never move, so nothing melts. The seller receives the price minus a {config.feeBps / 100}% Sequents
              desk fee. The buyer can keep it, gift it, relist it, or withdraw (which melts).
            </p>
          </More>
        </section>

        <section className="work">
          <h2>5. Why the premium can't go below the coin</h2>
          <FloorDiagram />
          <More>
            <p>
              A rare lot can always be withdrawn and sold as ordinary $PROOF at market price. The premium is the only part that depends
              on collectors — and ordinary $PROOF can itself go up or down.
            </p>
          </More>
        </section>
      </div>

      <h2>What you can check yourself</h2>
      <ul>
        <li>The $PROOF mint: {config.pending ? <span className="muted">announced at launch</span> : <Addr value={config.mint} />}</li>
        <li>The Sequents vault program: {config.pending ? <span className="muted">deployed at launch</span> : <Addr value={config.vaultProgramId} />}</li>
        <li>The trait commitment, posted by <Addr value={config.revealAuthority} /> before the first buy</li>
        <li>Every desk listing runs on-chain safety checks in your browser before you can buy</li>
        <li>Two independent indexers publish matching ledger fingerprints (shown in the footer)</li>
      </ul>
      <p className="muted small">
        The blockchain sees every $PROOF token as identical. Rarity is defined by the published Sequents rules and computed by our
        open-source indexer — anyone can replay the chain and get the same result.
      </p>
    </article>
  );
}
