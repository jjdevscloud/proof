// Pixel artwork: trait icons and the coin shape shared by the logo, coins and diagrams.

// Each icon is drawn on a grid: '#' tier colour, 'k' ink, 'G' green, 'g' frame grey, '.' empty.
const ICONS: Record<string, string[]> = {
  genesis: ['##.gg.gg.gg.gg', '##.gg.gg.gg.gg'],
  keydate: ['##.##.##.gg.gg', '##.##.##.gg.gg'],
  final: ['gg.gg.gg.gg.##', 'gg.gg.gg.gg.##'],
  common: ['##.##.##.##.##', '##.##.##.##.##'],
  doubledie: ['..###..##..', '.#####..##.', '#######.###', '#######.###', '#######.###', '.#####..##.', '..###..##..'],
  wrongplanchet: ['..###..', '.#####.', '##GGG##', '##GGG##', '##GGG##', '.#####.', '..###..'],
  offcenter: ['kk.......', 'k.....###', '.....####', '....#####', '....#####', '....#####', '.....####', 'k.....###', 'kk.......'],
  clipped: ['..###..', '.####..', '####...', '#####..', '#######', '.#####.', '..###..'],
  diecrack: ['..###..', '.###.#.', '###.###', '###.###', '##.####', '.#.###.', '..###..'],
};

export function PixelIcon({ name }: { name: string }) {
  const rows = ICONS[name];
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  return (
    <svg className="pi" viewBox={`0 0 ${w} ${h}`} width={w * 2} height={h * 2} aria-hidden shapeRendering="crispEdges">
      {rows.flatMap((row, y) =>
        [...row].map((c, x) => (c === '.' ? null : <rect key={`${x},${y}`} className={`pi-${c === '#' ? 't' : c}`} x={x} y={y} width={1} height={1} />)),
      )}
    </svg>
  );
}

// Trait name → [icon, display tier of the trait on its own].
const TRAIT_ICONS: Record<string, [string, number]> = {
  Genesis: ['genesis', 2],
  'Key Date': ['keydate', 1],
  'Final Strike': ['final', 1],
  'Common Date': ['common', 0],
  'Double Die': ['doubledie', 3],
  'Wrong Planchet': ['wrongplanchet', 3],
  'Off Center': ['offcenter', 2],
  'Off-Center': ['offcenter', 2],
  'Clipped Planchet': ['clipped', 2],
  'Die Crack': ['diecrack', 1],
};

export function TraitIcon({ trait }: { trait: string }) {
  const icon = TRAIT_ICONS[trait];
  if (!icon) return null;
  return (
    <span className={`trait-icon t${icon[1]}`}>
      <PixelIcon name={icon[0]} />
    </span>
  );
}

// Cells of a w×h coin with an "S"-like notch cut out, rotated by `angle` (radians).
// Returns [dx, dy] offsets from the centre cell.
export function coinCells(w: number, h: number, angle: number): [number, number][] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const hw = (w - 1) / 2;
  const hh = (h - 1) / 2;
  const top = -hh;
  const tip = -hh + (h - 1) * 0.6;
  const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  const r = Math.ceil(Math.hypot(w, h) / 2) + 1;
  const out: [number, number][] = [];
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      if (Math.abs(u) > hw + 0.35 || Math.abs(v) > hh + 0.35) continue;
      const edge = Math.abs(u) > hw - 0.6 || v < top + 0.6;
      const inNotch = Math.min(segDist(u, v, -hw, top, 0, tip), segDist(u, v, hw, top, 0, tip)) < 0.5;
      if (edge || !inNotch) out.push([x, y]);
    }
  }
  return out;
}
