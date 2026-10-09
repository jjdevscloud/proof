import type { Change, RangeJson, TxChanges } from '../api.ts';
import { useConfig } from '../App.tsx';
import { explorer, fmtTokens, short, sol } from '../format.ts';

function strikesIn(ranges: RangeJson[], strikeSize: bigint): string {
  const set = new Set<number>();
  for (const r of ranges) {
    for (let s = BigInt(r.start) / strikeSize; s * strikeSize < BigInt(r.end); s++) set.add(Number(s));
  }
  const list = [...set].sort((a, b) => a - b);
  if (!list.length) return '';
  return list.length > 3 ? `Strikes #${list[0]} to #${list[list.length - 1]}` : list.map((n) => `#${n}`).join(', ');
}

function total(ranges: RangeJson[]): bigint {
  return ranges.reduce((t, r) => t + BigInt(r.end) - BigInt(r.start), 0n);
}

const MELT_REASONS: Record<string, string> = {
  transfer: 'sent away',
  sellBack: 'sold back to the curve',
  burn: 'burned',
  ownerChange: 'account changed hands',
  invalidSeal: 'invalid seal',
  withdraw: 'withdrawn from envelope',
};

export function describe(ch: Change, strikeSize: bigint): { icon: string; tone: string; text: string } {
  switch (ch.kind) {
    case 'issue':
      return { icon: '◆', tone: 'issue', text: `${fmtTokens(total(ch.ranges))} minted in Strike ${strikesIn(ch.ranges, strikeSize)} to ${short(ch.account)}` };
    case 'melt':
      return { icon: '♨', tone: 'melt', text: `${fmtTokens(total(ch.ranges))} of Strike ${strikesIn(ch.ranges, strikeSize)} melted, ${MELT_REASONS[ch.reason] ?? ch.reason}` };
    case 'seal':
      if (ch.valid) return { icon: '▣', tone: 'seal', text: `Strike ${strikesIn(ch.ranges, strikeSize)} sealed into envelope ${short(ch.envelope)}` };
      return ch.ordinary
        ? { icon: '▢', tone: 'seal', text: `${fmtTokens(ch.ordinary)} ordinary $PROOF sealed into envelope ${short(ch.envelope)}` }
        : { icon: '▢', tone: 'melt', text: `Invalid seal into ${short(ch.envelope)}, contents are ordinary $PROOF` };
    case 'list':
      return { icon: '⌂', tone: 'desk', text: `Envelope ${short(ch.envelope)} listed for ${sol(ch.price)} SOL` };
    case 'cancel':
      return { icon: '⌂', tone: 'desk', text: `Envelope ${short(ch.envelope)} delisted` };
    case 'sale':
      return { icon: '⇄', tone: 'desk', text: `Envelope ${short(ch.envelope)} sold for ${sol(ch.price)} SOL to ${short(ch.to)}` };
    case 'gift':
      return { icon: '✉', tone: 'seal', text: `Envelope ${short(ch.envelope)} gifted to ${short(ch.to)}` };
    case 'withdraw':
      return { icon: '♨', tone: 'melt', text: `Envelope ${short(ch.envelope)} opened and withdrawn` };
    case 'commit':
      return { icon: '⚿', tone: 'seal', text: `Trait commitment posted on-chain (${ch.root.slice(0, 10)}…)` };
    case 'reveal':
      return { icon: '✦', tone: 'issue', text: 'Traits revealed and verified against the commitment' };
    case 'roll':
      return ch.valid
        ? { icon: '⟳', tone: 'seal', text: `Envelope ${short(ch.envelope)} rolled` }
        : { icon: '⟳', tone: 'melt', text: `Roll on envelope ${short(ch.envelope)} not counted: ${ch.reason}` };
    case 'rolled':
      return ch.points > 0
        ? { icon: '✦', tone: 'issue', text: `Envelope ${short(ch.envelope)} rolled ${ch.name}` }
        : { icon: '·', tone: 'melt', text: `Envelope ${short(ch.envelope)} rolled ${ch.name}` };
  }
}

export function ActivityFeed({ items, empty = 'No activity yet.' }: { items: TxChanges[]; empty?: string }) {
  const config = useConfig();
  const size = BigInt(config.strikeSize);
  const rows = items.flatMap((tx) => tx.changes.map((ch, i) => ({ tx, ch, key: `${tx.slot}-${tx.signature}-${i}-${ch.kind}` })));
  if (!rows.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="feed">
      {rows.map(({ tx, ch, key }) => {
        const d = describe(ch, size);
        return (
          <li key={key} className={`feed-${d.tone}`}>
            <span className="feed-icon" aria-hidden><FeedIcon glyph={d.icon} /></span>
            <span className="feed-text">{d.text}</span>
            <a className="feed-link mono small" href={explorer('tx', tx.signature)} target="_blank" rel="noreferrer">
              slot {tx.slot}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

// Pixel icons for the history, in the site's block style, keyed by the event's symbol above.
// '#' the event colour, '.' empty.
const FEED_ICONS: Record<string, string[]> = {
  // minted: a new coin
  '◆': ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'],
  // melted or withdrawn: a coin dissolving into loose blocks
  '♨': ['..###..', '.#####.', '#######', '##.#.##', '#.#.#.#', '.......', '#..#..#'],
  // sealed or gifted: the Sequents envelope
  '▣': ['#######', '##...##', '#.#.#.#', '#..#..#', '#######'],
  '✉': ['#######', '##...##', '#.#.#.#', '#..#..#', '#######'],
  // an invalid seal: the envelope, only its outline
  '▢': ['#######', '#.....#', '#.....#', '#.....#', '#######'],
  // listed or delisted on the desk: a price tag
  '⌂': ['..#####', '.#....#', '#..#..#', '.#....#', '..#####'],
  // sold: two arrows passing
  '⇄': ['....#..', '#######', '....#..', '..#....', '#######', '..#....'],
  // trait commitment: a padlock
  '⚿': ['..###..', '.#...#.', '.#...#.', '#######', '###.###', '###.###', '#######'],
  // traits revealed: a spark
  '✦': ['...#...', '...#...', '..###..', '#######', '..###..', '...#...', '...#...'],
  // a roll: a turning arrow
  '⟳': ['..####.', '.#....#', '#....##', '#......', '#......', '.#....#', '..####.'],
  // a roll that landed on nothing: a single dot
  '·': ['.......', '.......', '.......', '...#...', '.......', '.......', '.......'],
};

function FeedIcon({ glyph }: { glyph: string }) {
  const rows = FEED_ICONS[glyph];
  if (!rows) return <>{glyph}</>;
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  return (
    <svg className="feed-pi" viewBox={`0 0 ${w} ${h}`} width={w * 3} height={h * 3} shapeRendering="crispEdges">
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === '#' ? <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} /> : null)))}
    </svg>
  );
}
