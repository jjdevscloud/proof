// The site's pixel tick (and a pixel cross for a failed check), drawn in blocks like the logo.
const TICK = [[6, 0], [5, 1], [6, 1], [4, 2], [5, 2], [0, 3], [3, 3], [4, 3], [0, 4], [1, 4], [2, 4], [3, 4], [1, 5], [2, 5]];
const CROSS = [[0, 0], [5, 0], [1, 1], [4, 1], [2, 2], [3, 2], [2, 3], [3, 3], [1, 4], [4, 4], [0, 5], [5, 5]];

export function PixelTick({ className = '', bad = false }: { className?: string; bad?: boolean }) {
  return (
    <svg className={`pixel-tick ${bad ? 'pixel-tick-bad' : ''} ${className}`} viewBox={bad ? '0 0 6 6' : '0 0 7 6'} aria-hidden shapeRendering="crispEdges">
      {(bad ? CROSS : TICK).map(([x, y]) => <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} />)}
    </svg>
  );
}

// A small loader: the four rarity colours bobbing in turn, the same as the roll's loader.
export function PixelLoader() {
  return <span className="brand-loader" aria-hidden><i className="t0" /><i className="t1" /><i className="t2" /><i className="t3" /></span>;
}
