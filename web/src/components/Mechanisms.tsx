import { useState } from 'react';
import { useStepReveal } from './useStepReveal.ts';
import type { ReactNode } from 'react';
import { Modal } from './ui.tsx';
import { StepNav } from './StepNav.tsx';
import { ENV_H, ENV_W, envelopeShape } from './HeroWord.tsx';

// Three line diagrams redrawn from the white paper (figures 1 to 3). Each square opens a pop-up with
// the diagram large and a short explanation. Decorative SVG plus text.

const envCells = envelopeShape(ENV_W, ENV_H, 0);

// The site's pixel envelope, `b` units per block, centred on (x, y).
function PixelEnvelope({ x, y, b = 4, fill = 'fill-purple' }: { x: number; y: number; b?: number; fill?: string }) {
  const ox = x - (ENV_W * b) / 2, oy = y - (ENV_H * b) / 2;
  return (
    <g>
      {envCells.map(([dc, dr]) => (
        <rect key={`${dc},${dr}`} className={fill} x={ox + (dc + (ENV_W - 1) / 2) * b} y={oy + (dr + (ENV_H - 1) / 2) * b} width={b - 0.6} height={b - 0.6} />
      ))}
    </g>
  );
}

// A small cloud of loose blocks: tokens that have melted.
function Melt({ x, y }: { x: number; y: number }) {
  const pts = [[0, 0], [7, -4], [14, 2], [-6, 6], [4, 9], [18, -6], [-12, -3], [11, 12], [-3, -9], [22, 7], [-16, 9], [26, -1]];
  return <g>{pts.map(([dx, dy], i) => <rect key={i} className="fill-melt" x={x + dx} y={y + dy} width={3.4} height={3.4} />)}</g>;
}

function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const a = Math.atan2(y2 - y1, x2 - x1), s = 5;
  const p = (t: number) => `${x2 - s * Math.cos(a + t)},${y2 - s * Math.sin(a + t)}`;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <polygon className="fill-ink" points={`${x2},${y2} ${p(0.45)} ${p(-0.45)}`} />
    </g>
  );
}

function EnvelopesDiagram() {
  return (
    <svg className="gfx mech-gfx" viewBox="0 0 320 240" aria-hidden>
      {/* origin account: an outlined box holding its tokens */}
      <rect x={14} y={58} width={44} height={30} />
      {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} className="fill-ink" x={21 + (i % 3) * 11} y={65 + Math.floor(i / 3) * 10} width={7} height={6} />)}
      <text x={36} y={106} textAnchor="middle">ORIGIN</text>
      <text x={36} y={118} textAnchor="middle">ACCOUNT</text>
      <Arrow x1={64} y1={73} x2={124} y2={73} />
      <text x={94} y={64} textAnchor="middle">SEAL</text>
      <PixelEnvelope x={152} y={73} />
      <circle className="fill-bg" cx={152} cy={104} r={8} />
      <text x={152} y={107.5} textAnchor="middle">A</text>
      <text x={152} y={128} textAnchor="middle">HOLDER</text>
      <Arrow x1={180} y1={73} x2={244} y2={73} />
      <text x={212} y={64} textAnchor="middle">SALE</text>
      <text x={212} y={88} textAnchor="middle" className="t-muted">TOKENS STAY</text>
      <PixelEnvelope x={272} y={73} />
      <circle className="fill-bg" cx={272} cy={104} r={8} />
      <text x={272} y={107.5} textAnchor="middle">B</text>
      <text x={272} y={128} textAnchor="middle">HOLDER</text>
      <Arrow x1={272} y1={136} x2={272} y2={176} />
      <text x={264} y={154} textAnchor="end">WITHDRAW</text>
      <text x={264} y={166} textAnchor="end" className="t-muted">MELTS</text>
      <Melt x={262} y={192} />
      <text x={272} y={226} textAnchor="middle">ORDINARY TOKENS</text>
    </svg>
  );
}

function StrikesDiagram() {
  const cells = [0, 1, 2, 3, 4];
  return (
    <svg className="gfx mech-gfx" viewBox="0 0 320 240" aria-hidden>
      <path d="M22 70 V64 H64 V70" />
      <text x={43} y={56} textAnchor="middle">1,000,000 TOKENS</text>
      {cells.map((c) => (
        <g key={c}>
          <rect x={22 + c * 42} y={78} width={42} height={42} />
          <text x={43 + c * 42} y={104} textAnchor="middle">{c}</text>
        </g>
      ))}
      <text x={246} y={104} textAnchor="middle">···</text>
      <rect x={268} y={78} width={42} height={42} className="fill-purple" />
      <text x={289} y={104} textAnchor="middle" className="t-onfill">793</text>
      <path d="M22 128 V134 H232 V128" />
      <text x={127} y={150} textAnchor="middle" className="t-muted">GENESIS, STRIKES 0 TO 4</text>
      <path d="M22 214 C 150 214, 250 200, 300 158" />
      <polygon className="fill-ink" points="306,150 296,156 302,162" />
      <text x={22} y={232}>ORDER OF PURCHASE FROM THE CURVE</text>
    </svg>
  );
}

function SurvivalDiagram() {
  const rows: [string, string][] = [['ORDINARY BALANCE', 'r-ord'], ['COMMON', 'r-t0'], ['UNCOMMON', 'r-t1'], ['RARE', 'r-t2'], ['LEGENDARY', 'r-t3']];
  return (
    <svg className="gfx mech-gfx" viewBox="0 0 320 240" aria-hidden>
      <text x={96} y={44} textAnchor="middle">ORIGIN ACCOUNT</text>
      {rows.map(([label, cls], i) => (
        <g key={label}>
          <rect x={30} y={54 + i * 28} width={132} height={28} />
          <rect className={`fill-${cls}`} x={38} y={62 + i * 28} width={12} height={12} />
          <text x={58} y={72 + i * 28}>{label}</text>
        </g>
      ))}
      <Arrow x1={170} y1={68} x2={238} y2={68} />
      <text x={204} y={59} textAnchor="middle">LEAVES FIRST</text>
      <Melt x={252} y={67} />
      <text x={262} y={95} textAnchor="middle" className="t-muted">MELTS</text>
      <Arrow x1={170} y1={180} x2={238} y2={180} />
      <text x={204} y={171} textAnchor="middle">LEAVES LAST</text>
      <text x={96} y={214} textAnchor="middle" className="t-muted">RARE SUPPLY CAN ONLY FALL</text>
    </svg>
  );
}

type Mechanism = { key: string; name: string; line: string; body: string; Diagram: () => ReactNode };

// DRAFT wording, from the white paper, awaiting Harriet's approval.
const MECHANISMS: Mechanism[] = [
  {
    key: 'envelopes',
    name: 'Envelopes',
    line: 'how rarity changes hands without melting.',
    body: 'Seal rare tokens from the account that bought them into an envelope. The tokens move once, into a vault nobody holds a key to. When the envelope is sold only the holder changes, so the tokens stay put and keep their rarity. Withdraw them and they return as ordinary $PROOF.',
    Diagram: EnvelopesDiagram,
  },
  {
    key: 'strikes',
    name: 'Strikes',
    line: 'every million tokens, numbered in the order they were bought.',
    body: 'Tokens are numbered in the order they leave the curve. Every million is a Strike, 794 in all. The first Strikes carry date traits, and after the sale a public Solana block decides which Strikes receive errors, so nobody can know them in advance.',
    Diagram: StrikesDiagram,
  },
  {
    key: 'survival',
    name: 'Survival',
    line: 'rarity lives in two places only.',
    body: 'Rarity survives only in the account that bought it or inside an envelope. When tokens leave an account, ordinary ones go first, then the least rare. Anything that leaves melts into ordinary $PROOF forever, so every melt makes the survivors scarcer.',
    Diagram: SurvivalDiagram,
  },
];

export function Mechanisms() {
  const [at, setAt] = useState<number | null>(null);
  const open = at === null ? null : MECHANISMS[at];
  const { ref, shown, pinned } = useStepReveal(MECHANISMS.length);
  const step = (i: number) => (i < shown ? ' in' : '');
  return (
    <section className="mechanisms" ref={ref} style={pinned ? { height: `${100 + MECHANISMS.length * 40}vh` } : undefined}>
      <div className={pinned ? 'mech-stage' : undefined}>
      <div className="mech-titles">
        {MECHANISMS.map((m, i) => (
          <div key={m.key} className={`mech-step${step(i)}`}>
            <h2>{m.name}</h2>
            <p>{m.line}</p>
          </div>
        ))}
      </div>
      <div className="mech-row">
        {MECHANISMS.map((m) => (
          <button key={m.key} className={`mech mech-step${step(MECHANISMS.indexOf(m))}`} onClick={() => setAt(MECHANISMS.indexOf(m))} aria-label={`${m.name}: ${m.line}`}>
            <span className="mech-name" aria-hidden>{m.name}</span>
            <svg className="mech-expand" viewBox="0 0 14 14" aria-hidden>
              <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" />
            </svg>
            <m.Diagram />
          </button>
        ))}
      </div>
      </div>
      {open && (
        <Modal title={open.name} onClose={() => setAt(null)}>
          <div className="mech-modal">
            <open.Diagram />
            <p>{open.body}</p>
          </div>
          <StepNav at={at!} total={MECHANISMS.length} onMove={setAt} label="Illustrations" />
        </Modal>
      )}
    </section>
  );
}
