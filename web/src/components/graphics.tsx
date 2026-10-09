// Decorative line and bitmap graphics. Pure SVG drawn from fixed seeds: no data, no state, hidden from screen readers.

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Scattered bitmap squares that thicken toward one corner, after the reference posters.
export function PixelField({ seed = 7, cols = 72, rows = 34, className = '' }: { seed?: number; cols?: number; rows?: number; className?: string }) {
  const r = rng(seed);
  const cells: { x: number; y: number; c: string }[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dx = x / cols;
      const dy = 1 - y / rows;
      const d = Math.pow(dx, 1.6) * 0.75 + Math.pow(dy, 2) * 0.18 - 0.08;
      if (r() < d) {
        const k = r();
        cells.push({ x, y, c: k < 0.62 ? 'px-a' : k < 0.96 ? 'px-b' : 'px-c' });
      }
    }
  }
  return (
    <svg className={`gfx pixel-field ${className}`} viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="xMaxYMid slice" aria-hidden shapeRendering="crispEdges">
      {cells.map((p) => <rect key={`${p.x}-${p.y}`} className={p.c} x={p.x} y={p.y} width={1} height={1} />)}
    </svg>
  );
}

// Strike 0 to 793 on a ruler, with the first 25 Strikes drawn again at a larger scale.
export function StrikeRuler() {
  const s = (n: number) => 20 + (n * 480) / 793;
  const z = (n: number) => 20 + n * 20;
  return (
    <svg className="gfx" viewBox="0 0 520 170" aria-hidden>
      <line x1={20} y1={30} x2={500} y2={30} />
      {Array.from({ length: 33 }, (_, i) => i * 25).map((n) => (
        <line key={n} x1={s(n)} y1={30} x2={s(n)} y2={n % 100 === 0 ? 22 : 26} />
      ))}
      <text x={20} y={14}>0</text>
      <text x={500} y={14} textAnchor="end">793</text>
      <rect className="fill-ink" x={496.5} y={26.5} width={7} height={7} />
      <path className="dash" d={`M20 36 V104 M${s(24)} 36 L500 104`} />
      <line x1={20} y1={110} x2={500} y2={110} />
      {Array.from({ length: 25 }, (_, n) => (
        n < 5
          ? <circle key={n} className="fill-acc" cx={z(n)} cy={110} r={5.5} />
          : <circle key={n} className="fill-bg" cx={z(n)} cy={110} r={3.5} />
      ))}
      <text x={z(0)} y={134} textAnchor="middle">0</text>
      <text x={z(4)} y={134} textAnchor="middle">4</text>
      <text x={z(5)} y={134} textAnchor="middle">5</text>
      <text x={z(24)} y={134} textAnchor="middle">24</text>
      <path d={`M${z(0)} 146 V152 H${z(4)} V146 M${z(5)} 146 V152 H${z(24)} V146`} />
    </svg>
  );
}

// One source, two places rarity survives, and every other path dissolving.
export function TwoPlaces() {
  const r = rng(11);
  const bits = Array.from({ length: 46 }, () => ({ x: 380 + r() * 120, y: 86 + (r() - 0.5) * (12 + r() * 40) }));
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
      {bits.map((b, i) => <rect key={i} className="fill-melt" x={b.x} y={b.y} width={4} height={4} />)}
    </svg>
  );
}

// Survivors falling step by step inside a bracket frame.
export function MeltCurve() {
  const pts = [[40, 30], [110, 30], [110, 62], [190, 62], [190, 88], [270, 88], [270, 120], [360, 120], [360, 134], [470, 134]];
  return (
    <svg className="gfx" viewBox="0 0 520 170" aria-hidden>
      <path d="M14 10 V22 M14 10 H26 M506 10 V22 M506 10 H494 M14 160 V148 M14 160 H26 M506 160 V148 M506 160 H494" />
      {['05', '04', '03', '02', '01'].map((t, i) => <text key={t} x={30} y={34 + i * 26} textAnchor="end">{t}</text>)}
      <path className="dash" d="M40 146 H480" />
      <polyline points={pts.map((p) => p.join(',')).join(' ')} />
      {pts.filter((_, i) => i % 2 === 0).map(([x, y]) => <circle key={`${x}${y}`} className="fill-bg" cx={x} cy={y} r={3.5} />)}
      {pts.filter((_, i) => i % 2 === 1).map(([x, y]) => <rect key={`${x}${y}`} className="fill-ink" x={x - 3} y={y - 3} width={6} height={6} />)}
    </svg>
  );
}

// a pays b over the bus; the envelope in the middle never moves.
export function EnvelopeFlow() {
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

// A wave that can rise and fall but never crosses the floor beneath it.
export function FloorWave() {
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

// A sphere of dots, sized by depth.
export function DotSphere({ seed = 3 }: { seed?: number }) {
  const r = rng(seed);
  const dots: { x: number; y: number; s: number }[] = [];
  const n = 260;
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = i * 2.399963 + r() * 0.05;
    const x = Math.cos(th) * rad;
    const zz = Math.sin(th) * rad;
    if (zz < -0.15) continue;
    dots.push({ x: 100 + x * 84, y: 100 + y * 84, s: 1.2 + (zz + 0.15) * 3 });
  }
  return (
    <svg className="gfx" viewBox="0 0 200 200" aria-hidden>
      {dots.map((d, i) => <rect key={i} className="fill-ink" x={d.x - d.s / 2} y={d.y - d.s / 2} width={d.s} height={d.s} />)}
    </svg>
  );
}

// A dial with a tick scale and one marked point, for the seed block.
export function SeedDial() {
  return (
    <svg className="gfx" viewBox="0 0 200 200" aria-hidden>
      <circle className="no-fill" cx={100} cy={100} r={80} />
      <line x1={100} y1={20} x2={100} y2={100} />
      {Array.from({ length: 6 }, (_, i) => <line key={i} x1={100} y1={34 + i * 11} x2={106} y2={34 + i * 11} />)}
      <rect className="fill-ink" x={96} y={16} width={8} height={8} />
      <circle className="fill-acc" cx={100} cy={100} r={5} />
      {Array.from({ length: 60 }, (_, i) => {
        const a = (i / 60) * Math.PI * 2;
        const r1 = i % 5 ? 84 : 88;
        return <line key={i} x1={100 + Math.sin(a) * 80} y1={100 - Math.cos(a) * 80} x2={100 + Math.sin(a) * r1} y2={100 - Math.cos(a) * r1} />;
      })}
    </svg>
  );
}

// Nodes on stalks, scattered: holders around a Strike.
export function NodeCluster({ seed = 5, count = 14 }: { seed?: number; count?: number }) {
  const r = rng(seed);
  return (
    <svg className="gfx" viewBox="0 0 200 200" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const a = r() * Math.PI * 2;
        const d0 = 14 + r() * 30;
        const d1 = d0 + 20 + r() * 34;
        const x0 = 100 + Math.cos(a) * d0, y0 = 100 + Math.sin(a) * d0;
        const x1 = 100 + Math.cos(a) * d1, y1 = 100 + Math.sin(a) * d1;
        return (
          <g key={i}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} />
            <rect className={i % 5 === 0 ? 'fill-acc' : 'fill-ink'} x={x0 - 2.5} y={y0 - 2.5} width={5} height={5} />
            <circle className="fill-bg" cx={x1} cy={y1} r={3} />
          </g>
        );
      })}
    </svg>
  );
}
