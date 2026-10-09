import { useEffect, useRef, useState } from 'react';
import { ICONS, traitShare } from './TraitIcons.tsx';

// The trait coins drifting left to right through the frame, each spinning like a flipped coin. They set
// off at random times and heights from beyond the left edge, each at its own pace, and leave past the
// right edge. They keep to the space above and below the text so they never pass over it. Decorative only.

// Each trait and the colour it has in the traits table.
// Name, kind and rarity tier are for the hover label.
const TRAITS: [string, string, string, string, number][] = [
  ['genesis', '--t2', 'Genesis', 'Date', 2], ['keydate', '--t1', 'Key Date', 'Date', 1], ['final', '--t1', 'Final Strike', 'Date', 1],
  ['common', '--t0', 'Common Date', 'Date', 0], ['doubledie', '--t3', 'Double Die', 'Error', 3], ['wrongplanchet', '--t3', 'Wrong Planchet', 'Error', 3],
  ['offcenter', '--t2', 'Off Center', 'Error', 2], ['clipped', '--t2', 'Clipped Planchet', 'Error', 2], ['diecrack', '--t1', 'Die Crack', 'Error', 1],
  // The rolled tiers, after the curve, mixed in with the curve traits.
  ['hoard', '--t3', 'Hoard', 'Roll', 3], ['pattern', '--t3', 'Pattern', 'Roll', 3], ['dietrial', '--t3', 'Die Trial', 'Roll', 3],
  ['overstrike', '--t2', 'Overstrike', 'Roll', 2], ['restrike', '--t2', 'Restrike', 'Roll', 2], ['secondstrike', '--t2', 'Second Strike', 'Roll', 2],
  ['recoinage', '--t1', 'Recoinage', 'Roll', 1], ['reissue', '--t1', 'Reissue', 'Roll', 1], ['mintrun', '--t1', 'Mint Run', 'Roll', 1],
  ['assay', '--t1', 'Assay', 'Roll', 1], ['coal', '--t0', 'Coal', 'Roll', 0],
];
// A rolled tier's chance per roll, from the rules, for the hover label.
const ROLL_ODDS: Record<string, string> = {
  'Hoard': '0.05%', 'Pattern': '0.1%', 'Die Trial': '0.2%', 'Overstrike': '0.4%', 'Restrike': '0.6%', 'Second Strike': '1%',
  'Recoinage': '1.5%', 'Reissue': '2%', 'Mint Run': '3%', 'Assay': '4%', 'Coal': '87.15%',
};
const PX = 3; // one coin pixel on screen

type Coin = { x: number; y: number; row: number; speed: number; spin: number; phase: number; kind: number };

export function CoinStream() {
  const ref = useRef<HTMLCanvasElement>(null);
  // Hovering a coin stops it and shows a small black label, as on the Strikes page.
  const [tip, setTip] = useState<{ x: number; y: number; kind: number } | null>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, dpr = 1, raf = 0, alive = true, last = performance.now();
    let coins: Coin[] = [];
    let wait = 0;
    let held: Coin | null = null;

    // The frame is split into rows a coin high; each row has its own pace, and a coin only sets off in a
    // row when the last one there is well clear, so no two coins ever overlap.
    let rows: { y: number; speed: number }[] = [];
    const ROW = 15 * PX + 10, GAP = 15 * PX * 2.4;

    const size = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const n = Math.max(1, Math.floor((h - 24) / ROW));
      const top = (h - n * ROW) / 2;
      rows = Array.from({ length: n }, (_, i) => ({ y: top + i * ROW + 4, speed: 12 + Math.random() * 38 })); // some rows slow, some quick
      // A few coins across the frame straight away, so it never opens empty.
      coins = [];
      for (let i = 0; i < Math.round(w / 200); i++) launch(Math.random() * (w - GAP));
    };

    const launch = (x = -15 * PX) => {
      // Rows with room at this point, chosen at random.
      const free = rows.map((_, i) => i).filter((i) => coins.every((c) => c.row !== i || Math.abs(c.x - x) > GAP));
      if (!free.length) return;
      const row = free[Math.floor(Math.random() * free.length)];
      coins.push({
        x,
        y: rows[row].y,
        row,
        speed: rows[row].speed,
        // About half spin, a full turn every few seconds; the rest glide face on.
        spin: Math.random() < 0.5 ? 0 : 1.2 + Math.random() * 0.9,
        phase: Math.random() < 0.5 ? 0 : Math.random() * Math.PI * 2,
        kind: Math.floor(Math.random() * TRAITS.length),
      });
    };

    const paint = () => {
      const css = getComputedStyle(canvas);
      const col = (c: string, tier: string) => css.getPropertyValue(c === '#' ? tier : c === 'k' ? '--ink' : c === 'G' ? '--green' : '--frame').trim();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const c of coins) {
        const [name, tier] = TRAITS[c.kind];
        const icon = ICONS[name];
        const cw = Math.max(...icon.map((r) => r.length));
        // Spinning: the coin narrows to an edge and widens again, the pixels keeping their height.
        // A full turn: the coin narrows to its edge, comes round mirrored, and turns back to face on.
        const cos = c.spin ? Math.cos(c.phase) : 1;
        const back = cos < 0;
        const face = icon; // the same coin all the way round, mirrored on its far side
        const fw = Math.max(...face.map((r) => r.length));
        const flip = back ? -1 : 1;
        const pw = PX * Math.abs(cos);
        const cx = c.x + (cw * PX) / 2;
        if (pw < 0.9) {
          // Edge on: just the rim, a thin upright bar.
          ctx.fillStyle = css.getPropertyValue(tier).trim();
          ctx.fillRect(cx - 1, c.y + (face.length * PX) * 0.08, 2, face.length * PX * 0.84);
        } else {
          face.forEach((r, y) => [...r].forEach((ch, x) => {
            if (ch === '.') return;
            ctx.fillStyle = col(ch, tier);
            ctx.fillRect(cx + flip * (x - fw / 2) * pw - (back ? pw : 0), c.y + y * PX, Math.max(0.6, pw - 0.15), PX);
          }));
        }
      }
    };

    const frame = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      for (const c of coins) {
        // The hovered coin stops; so does its row, so nothing behind it catches up.
        if (held && c.row === held.row) continue;
        c.x += c.speed * dt;
        c.phase += c.spin * dt; // always the same way round
      }
      coins = coins.filter((c) => c.x < w + 20 * PX);
      // A new coin every so often, at no fixed rhythm.
      wait -= dt;
      if (wait <= 0) {
        launch();
        // Irregular gaps, now and then a longer lull, so it feels spontaneous.
        wait = Math.random() < 0.2 ? 3 + Math.random() * 2.5 : 1.1 + Math.random() * 1.9;
      }
      paint();
      if (alive) raf = requestAnimationFrame(frame);
    };

    size();
    if (still) paint();
    else raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => { size(); paint(); });
    ro.observe(canvas);
    const hit = (mx: number, my: number) => coins.find((c) => {
      const rows = ICONS[TRAITS[c.kind][0]];
      const cw = Math.max(...rows.map((r) => r.length)) * PX;
      return mx >= c.x - 4 && mx <= c.x + cw + 4 && my >= c.y - 4 && my <= c.y + rows.length * PX + 4;
    }) ?? null;
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      held = hit(e.clientX - r.left, e.clientY - r.top);
      canvas.style.cursor = held ? 'pointer' : '';
      setTip(held ? { x: e.clientX, y: e.clientY, kind: held.kind } : null);
    };
    const leave = () => { held = null; setTip(null); };
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

  const [, , name, kind, tierN] = tip ? TRAITS[tip.kind] : ['', '', '', '', 0];
  return (
    <>
      <canvas ref={ref} className="coin-stream" aria-hidden />
      {tip && (
        <div className="hover-tip coin-tip" style={{ left: tip.x + 14, top: tip.y + 14 }} aria-hidden>
          <i className={`tip-swatch tip-${tierN}`} />
          <span className="tip-body">
            <strong>{name} {kind === 'Roll' ? `${ROLL_ODDS[name as string]} per roll` : traitShare(name as string)}</strong>
          </span>
        </div>
      )}
    </>
  );
}
