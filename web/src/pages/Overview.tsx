import { useEffect, useRef, useState } from 'react';
import { isAddress } from '../chain.ts';
import { Mechanisms } from '../components/Mechanisms.tsx';
import { PixelIcon } from '../components/pixels.tsx';
import { ScrollLines, useScrollSteps } from '../components/scroll.tsx';
import { WordCanvas } from '../components/WordCanvas.tsx';

export const WHITEPAPER = './Sequents_Whitepaper.pdf';

// [name, strikes, points, icon, tier]
type TraitRow = [string, string, number, string, number];
const DATE_ROWS: TraitRow[] = [
  ['Genesis', 'Strikes 0 to 4', 40, 'genesis', 2],
  ['Key Date', 'Strikes 5 to 24', 15, 'keydate', 1],
  ['Final Strike', 'Strike 793', 10, 'final', 1],
  ['Common Date', 'all others', 0, 'common', 0],
];
const ERROR_ROWS: TraitRow[] = [
  ['Double Die', '3', 100, 'doubledie', 3],
  ['Wrong Planchet', '6', 70, 'wrongplanchet', 3],
  ['Off Center', '12', 50, 'offcenter', 2],
  ['Clipped Planchet', '24', 30, 'clipped', 2],
  ['Die Crack', '48', 15, 'diecrack', 1],
];

function TraitTableRow({ kind, row: [name, strikes, points, icon, t], on }: { kind: string; row: TraitRow; on: boolean }) {
  return (
    <tr className={on ? 'step in' : 'step'}>
      <td>{kind}</td>
      <td>
        <span className={`trait-name t${t}`}>
          <span className="pi-box"><PixelIcon name={icon} /></span>
          {name}
        </span>
      </td>
      <td className="num">{strikes}</td>
      <td className="num">{points}</td>
    </tr>
  );
}

function TraitsTable() {
  const count = DATE_ROWS.length + ERROR_ROWS.length;
  const { ref, shown, pinned } = useScrollSteps(count);
  return (
    <section className="traits-scroll" ref={ref} style={pinned ? { height: `${100 + count * 16}vh` } : undefined}>
      <div className={pinned ? 'traits-stage' : undefined}>
        <div className="traits-free">
          <h2>Traits</h2>
          <p>Every Strike has a date trait and may have one error. Date traits are positional and visible from the moment a Strike is sold. Errors are random, named after real minting errors, and assigned at the reveal.</p>
          <table className="table">
            <thead>
              <tr><th>Kind</th><th>Trait</th><th className="num">Strikes</th><th className="num">Points</th></tr>
            </thead>
            <tbody>
              {DATE_ROWS.map((r, i) => <TraitTableRow key={r[0]} kind="Date" row={r} on={i < shown} />)}
            </tbody>
            <tbody className="group">
              {ERROR_ROWS.map((r, i) => <TraitTableRow key={r[0]} kind="Error" row={r} on={DATE_ROWS.length + i < shown} />)}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const CHECK_PIXELS = [[6, 0], [5, 1], [6, 1], [4, 2], [5, 2], [0, 3], [3, 3], [4, 3], [0, 4], [1, 4], [2, 4], [3, 4], [1, 5], [2, 5]];

function VerifyHoldings() {
  const [input, setInput] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <div className="closer-box">
      <svg className="verify-check" viewBox="0 0 7 6" aria-hidden shapeRendering="crispEdges">
        {CHECK_PIXELS.map(([x, y]) => <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} />)}
      </svg>
      <h2>Verify holdings</h2>
      <p className="muted">Check which rare $PROOF any wallet holds.</p>
      <form
        className="closer-form"
        onSubmit={(e) => {
          e.preventDefault();
          const a = input.trim();
          if (isAddress(a)) location.hash = `#/wallet/${a}`;
          else setBad(true);
        }}
      >
        <input
          placeholder="Paste a Solana address"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setBad(false);
          }}
          aria-label="Wallet address"
          spellCheck={false}
        />
        <button className="btn btn-primary">Verify</button>
      </form>
      {bad && <p className="error-note">That doesn't look like a Solana address.</p>}
    </div>
  );
}

const STEP = 9;

// Full-bleed field of pixels rising from the bottom of the page; pixels part around the pointer.
function BlockField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0;
    let H = 0;
    let cols = 0;
    let rows = 0;
    let dpr = 1;
    let raf = 0;
    let alive = true;
    let colourOf = new Uint8Array();
    let threshold = new Float32Array();
    const pointer = { x: -1e4, y: -1e4 };
    const t0 = performance.now();

    const size = () => {
      const vw = document.documentElement.clientWidth;
      canvas.style.width = `${vw}px`;
      canvas.style.marginLeft = '0px';
      canvas.style.marginLeft = `${-canvas.getBoundingClientRect().left}px`;
      W = vw;
      H = Math.floor(canvas.getBoundingClientRect().height);
      cols = Math.ceil(W / STEP) + 1;
      rows = Math.ceil(H / STEP);
      dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      colourOf = new Uint8Array(cols * rows);
      threshold = new Float32Array(cols * rows);
      let seed = 11;
      const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < cols * rows; i++) {
        threshold[i] = rand();
        const r = rand();
        colourOf[i] = r < 0.03 ? 1 : r < 0.05 ? 2 : r < 0.07 ? 3 : 0;
      }
    };

    const draw = (now: number) => {
      const t = reduced ? 0 : (now - t0) / 1000;
      const cs = getComputedStyle(canvas);
      const colours = ['--word', '--word-2', '--word-3', '--word-4'].map((v) => cs.getPropertyValue(v).trim());
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const left = (W - cols * STEP + 2) / 2;
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = colours[c];
        for (let y = 0; y < rows; y++) {
          const depth = y / (rows - 1);
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            const off = Math.abs(x - (cols - 1) / 2);
            const wave = 0.16 * Math.sin(off * 0.045 - t * 0.35) + 0.08 * Math.sin(off * 0.11 + t * 0.5 + y * 0.05);
            const level = Math.max(0, depth + wave) ** 1.7;
            if (threshold[i] > level) continue;
            let px = left + x * STEP;
            let py = y * STEP;
            let col = colourOf[i];
            const dx = px - pointer.x;
            const dy = py - pointer.y;
            const d = Math.hypot(dx, dy);
            if (d < 99) {
              const push = (1 - d / 99) * STEP * 2.4;
              px += (dx / (d || 1)) * push;
              py += (dy / (d || 1)) * push;
              if (d < 39.6) col = 1;
            }
            if (col === c) ctx.fillRect(Math.round(px), Math.round(py), 7, 7);
          }
        }
      }
      if (alive && !reduced) raf = requestAnimationFrame(draw);
    };

    size();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(() => {
      size();
      if (reduced) requestAnimationFrame(draw);
    });
    ro.observe(canvas);
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
    };
    const leave = () => {
      pointer.x = pointer.y = -1e4;
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
    };
  }, []);
  return <canvas ref={ref} className="block-field" aria-hidden />;
}

export function Overview() {
  return (
    <>
      <section className="hero">
        <div className="caption">
          <h1>An Ordinal Theory for<br />Solana Tokens.</h1>
        </div>
        <div className="frame hero-frame">
          <WordCanvas text="SEQUENTS" />
        </div>
        <div className="trio">
          <p><strong>Sequents</strong> <span>the rules that number every token and decide which ones are rare.</span></p>
          <p><strong>$PROOF</strong> <span>the first token to implement<br />Sequent Theory.</span></p>
          <p><strong>Strikes</strong> <span>a run of one million tokens, the thing that holds traits and rarity.</span></p>
        </div>
      </section>
      <ScrollLines
        text="In 2022, Casey Rodarmor gave every Bitcoin sat a number, and some sats became rare. Solana never had an equivalent because Solana wallets store balances not individual coins, so a token's history disappears the moment it moves. Sequents proposes a solution: keep rare tokens where their history can be proven, in the account that bought them, or sealed in an envelope that never moves them. Every $PROOF has a number, and some numbers are rare."
        after={(
          <>
            <p className="muted">Read Our Proposal</p>
            <a className="btn btn-primary" href={WHITEPAPER} target="_blank" rel="noreferrer">Whitepaper</a>
          </>
        )}
      />
      <Mechanisms />
      <TraitsTable />
      <ScrollLines
        className="verify"
        text="Nothing in Sequents asks to be trusted. You can check every trait yourself with the following steps, or verify any wallet's holdings below."
        link={{ phrase: 'following steps', href: `${WHITEPAPER}#page=7&nameddest=section.10` }}
        after={<VerifyHoldings />}
      />
      <section className="closer">
        <BlockField />
      </section>
    </>
  );
}
