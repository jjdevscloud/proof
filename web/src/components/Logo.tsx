import { ENV_W, ENV_H, envelopeShape } from './HeroWord.tsx';

// The Sequents mark: the same solid pixel envelope that lifts out of the hero word, block for block.
const cells = envelopeShape(ENV_W, ENV_H, 0);
const ox = (ENV_W - 1) / 2, oy = (ENV_H - 1) / 2;

export function Logo() {
  return (
    <svg className="logo" viewBox={`0 0 ${ENV_W * 7 - 1} ${ENV_H * 7 - 1}`} aria-hidden shapeRendering="crispEdges">
      {cells.map(([dc, dr]) => (
        <rect key={`${dc},${dr}`} x={(dc + ox) * 7} y={(dr + oy) * 7} width={6} height={6} />
      ))}
    </svg>
  );
}
