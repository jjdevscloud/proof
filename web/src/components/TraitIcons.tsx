// The pixel icon for each trait, shared by the Traits table and every trait tag on the site.

// Pixel maps: '#' the trait's tier colour, 'k' ink, 'G' green, 'g' neutral grey, '.' empty.
export const ICONS: Record<string, string[]> = {
  // Date traits are the same coin stamped with a mark. The first Strikes: a 0.
  genesis: ['..#####..', '.#######.', '####.####', '###.#.###', '###.#.###', '###.#.###', '####.####', '.#######.', '..#####..'],
  // Key dates: a keyhole.
  keydate: ['..#####..', '.#######.', '####.####', '###...###', '####.####', '####.####', '###...###', '.#######.', '..#####..'],
  // The final Strike: the bowling X for a strike.
  final: ['..#####..', '.#######.', '##.###.##', '###.#.###', '####.####', '###.#.###', '##.###.##', '.#######.', '..#####..'],
  // Every other date: the plain coin.
  common: ['..#####..', '.#######.', '#########', '#########', '#########', '#########', '#########', '.#######.', '..#####..'],
  // Struck twice: two coins, each a lit bomb.
  doubledie: ['.....#.#..#.#', '......#....#.', '.....#.#..#.#', '....#....#...', '...#....#....', '..###..##....', '.#####..##...', '#######.###..', '#######.###..', '#######.###..', '.#####..##...', '..###..##....'],
  // Struck on the wrong metal: a no entry sign over the green core.
  wrongplanchet: ['..#####..', '.#######.', '####GG###', '##G##GG##', '##GG##G##', '##GGG####', '###GGG###', '.#######.', '..#####..'],
  // Struck off its mark: the coin sits away from the corners that frame where it should be.
  offcenter: ['kk.........', 'k.......###', '.......####', '......#####', '......#####', '......#####', '......#####', '......#####', '.......####', 'k.......###', 'kk.........'],
  // A bite clipped from the edge, and the scissors that took it.
  clipped: ['..#####..k...kk', '.######...k.kkk', '#######....k...', '######....k.kkk', '#######..k...kk', '#######........', '#########......', '.#######.......', '..#####........'],
  // A single zigzag crack running through it.
  diecrack: ['..###.#..', '.####.##.', '####.####', '###.#####', '####.####', '#####.###', '####.####', '.##.####.', '..#.###..'],
};

// Every icon is drawn in the same square, so coins and blocks come out the same size everywhere.
const BOX = 15;

// `tight` crops the square to the icon itself (for inline tags), keeping the same pixel size.
export function PixelIcon({ name, unit = 2, tight = false }: { name: string; unit?: number; tight?: boolean }) {
  const rows = ICONS[name];
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  const bw = tight ? w : BOX, bh = tight ? h : BOX;
  const ox = Math.floor((bw - w) / 2), oy = Math.floor((bh - h) / 2);
  return (
    <svg className="pi" viewBox={`0 0 ${bw} ${bh}`} width={bw * unit} height={bh * unit} aria-hidden shapeRendering="crispEdges">
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === '.' ? null : <rect key={`${x},${y}`} className={`pi-${c === '#' ? 't' : c}`} x={x + ox} y={y + oy} width={1} height={1} />)))}
    </svg>
  );
}


// Trait name to its icon, and the rarity tier its points put it in (for the icon's colour).
const BY_NAME: Record<string, [string, number]> = {
  'Genesis': ['genesis', 2],
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

export function TraitIcon({ trait, unit = 1.5 }: { trait: string; unit?: number }) {
  const hit = BY_NAME[trait];
  if (!hit) return null;
  return <span className={`trait-icon t${hit[1]}`}><PixelIcon name={hit[0]} unit={unit} tight /></span>;
}

// How many of the 794 Strikes carry each trait, from the rules (the traits table), and that as a share.
const TRAIT_STRIKES: Record<string, number> = {
  'Genesis': 5, 'Key Date': 20, 'Final Strike': 1, 'Common Date': 768,
  'Double Die': 3, 'Wrong Planchet': 6, 'Off Center': 12, 'Clipped Planchet': 24, 'Die Crack': 48,
};
// A share as a short percentage: two decimals under 1%, one above.
export function shareText(part: number, whole: number): string {
  if (!whole) return '';
  const p = (part / whole) * 100;
  return `${p < 1 ? p.toFixed(2) : p.toFixed(1)}%`;
}

export function traitShare(trait: string): string {
  const n = TRAIT_STRIKES[trait];
  if (n === undefined) return '';
  const p = (n / 794) * 100;
  return `${p < 1 ? p.toFixed(2) : p.toFixed(1)}%`;
}
