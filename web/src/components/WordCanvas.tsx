import { useEffect, useRef } from 'react';
import { coinCells } from './pixels.tsx';

const BANDS = 16;
const ANGLES = [0, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, Math.PI];

type Coin = {
  members: number[];
  dx: Float32Array;
  dy: Float32Array;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  born: number;
  colour: number;
  half: number;
};

// The hero word drawn as a field of pixels that fly in, scatter from the pointer, and every so
// often lift a coin-shaped group of pixels out of the word.
export function WordCanvas({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let alive = true;
    let built = false;
    let W = 0;
    let H = 0;
    let cell = 6;
    let dpr = 1;
    let n = 0;
    let homeX = new Float32Array();
    let homeY = new Float32Array();
    let px = new Float32Array();
    let py = new Float32Array();
    let vx = new Float32Array();
    let vy = new Float32Array();
    let delay = new Float32Array();
    let flash = new Float32Array();
    let coinOf = new Int32Array();
    let grid = new Int32Array();
    let cols = 0;
    let rows = 0;
    let coins: (Coin | null)[] = [];
    let t0 = performance.now();
    let last = t0;
    let nextCoin = 2.6;
    let maxCoins = 1;
    let nextMax = 2.6;
    let colour = 0;
    const bandUsed = Array.from({ length: BANDS }, () => -1e9 - Math.random() * 100);
    const pointer = { x: -1e4, y: -1e4 };
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    const build = async () => {
      const cs = getComputedStyle(canvas);
      const font = cs.getPropertyValue('--word-font').trim() || '400 100px monospace';
      const stretch = parseFloat(cs.getPropertyValue('--word-stretch')) || 1;
      await document.fonts.load(font, text).catch(() => {});
      if (!alive) return;
      W = Math.floor(canvas.getBoundingClientRect().width) || canvas.parentElement!.clientWidth;
      cell = W < 500 ? 3 : W < 900 ? 5 : 7;
      const padTop = cell * 10;
      const padBottom = cell * 4;
      const m = document.createElement('canvas').getContext('2d')!;
      m.font = font;
      const probe = m.measureText(text);
      const size = (100 * W) / (probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight);
      const sized = font.replace(/\d+px/, `${size}px`);
      m.font = sized;
      const metrics = m.measureText(text);
      const ascent = metrics.actualBoundingBoxAscent;
      H = Math.ceil((ascent + metrics.actualBoundingBoxDescent) * stretch) + padTop + padBottom;
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const o = off.getContext('2d')!;
      o.font = sized;
      o.translate(0, padTop);
      o.scale(1, stretch);
      o.fillText(text, metrics.actualBoundingBoxLeft, ascent);
      const data = o.getImageData(0, 0, W, H).data;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let y = 0; y + cell <= H; y += cell) {
        for (let x = 0; x + cell <= W; x += cell) {
          if (data[((y + (cell >> 1)) * W + x + (cell >> 1)) * 4 + 3] > 110) {
            xs.push(x);
            ys.push(y);
          }
        }
      }
      n = xs.length;
      homeX = Float32Array.from(xs);
      homeY = Float32Array.from(ys);
      px = new Float32Array(n);
      py = new Float32Array(n);
      vx = new Float32Array(n);
      vy = new Float32Array(n);
      delay = new Float32Array(n);
      flash = new Float32Array(n);
      coinOf = new Int32Array(n).fill(-1);
      cols = Math.floor(W / cell) + 1;
      rows = Math.floor(H / cell) + 1;
      grid = new Int32Array(cols * rows).fill(-1);
      for (let i = 0; i < n; i++) grid[(homeY[i] / cell) * cols + homeX[i] / cell] = i;
      coins = [];
      seed = 7;
      const flyIn = !reduced && !built;
      for (let i = 0; i < n; i++) {
        px[i] = flyIn ? -rand() * W * 0.5 : homeX[i];
        py[i] = flyIn ? rand() * H : homeY[i];
        delay[i] = flyIn ? (homeX[i] / W) * 1.1 + rand() * 0.35 : 0;
      }
      dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.height = `${H}px`;
      if (!built) t0 = performance.now();
      last = performance.now();
      built = true;
    };

    const liftCoin = (t: number) => {
      const band = bandUsed.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])[Math.floor(Math.random() * 4)][1];
      const x0 = (band / BANDS) * W;
      const x1 = ((band + 1) / BANDS) * W;
      const candidates: number[] = [];
      for (let i = 0; i < n; i++) if (homeX[i] >= x0 && homeX[i] < x1) candidates.push(i);
      for (let attempt = 0; attempt < 3; attempt++) {
        const shape = coinCells(7, 5, ANGLES[Math.floor(Math.random() * ANGLES.length)]);
        for (let k = 0; k < 120 && candidates.length; k++) {
          const centre = candidates[Math.floor(Math.random() * candidates.length)];
          const gx = homeX[centre] / cell;
          const gy = homeY[centre] / cell;
          const members: number[] = [];
          let ok = true;
          for (const [dx, dy] of shape) {
            const x = gx + dx;
            const y = gy + dy;
            const i = x >= 0 && x < cols && y >= 0 && y < rows ? grid[y * cols + x] : -1;
            if (i < 0 || coinOf[i] !== -1 || t < delay[i] || Math.abs(px[i] - homeX[i]) + Math.abs(py[i] - homeY[i]) > cell) {
              ok = false;
              break;
            }
            members.push(i);
          }
          if (!ok) continue;
          const id = coins.length;
          coins.push({
            members,
            dx: Float32Array.from(members.map((i) => homeX[i] - homeX[centre])),
            dy: Float32Array.from(members.map((i) => homeY[i] - homeY[centre])),
            cx: homeX[centre],
            cy: homeY[centre],
            vx: (Math.random() - 0.5) * 30,
            vy: 0,
            born: t,
            colour: (colour = 1 + ((colour + Math.floor(Math.random() * 2)) % 3)),
            half: Math.max(...members.map((i) => Math.abs(homeY[i] - homeY[centre]))) + cell,
          });
          for (const i of members) coinOf[i] = id;
          bandUsed[band] = t;
          return;
        }
      }
      bandUsed[band] = t;
    };

    const draw = (t: number) => {
      const cs = getComputedStyle(canvas);
      const colours = ['--word', '--word-2', '--word-3', '--word-4'].map((v) => cs.getPropertyValue(v).trim());
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const s = cell - 1;
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = colours[c];
        for (let i = 0; i < n; i++) {
          const coin = coinOf[i] >= 0 ? coins[coinOf[i]] : null;
          const col = coin ? (t - coin.born > 0.15 ? coin.colour : 0) : +(flash[i] > t);
          if (col === c) ctx.fillRect(Math.round(px[i]), Math.round(py[i]), s, s);
        }
      }
    };

    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (t > nextMax) {
        maxCoins = Math.random() < 0.5 ? 1 : 2;
        nextMax = t + 4 + Math.random() * 3;
      }
      const active = coins.reduce((a, c) => a + +!!c, 0);
      if (t > nextCoin && active < maxCoins) {
        liftCoin(t);
        nextCoin = t + 1.1 + Math.random() * 0.9;
      }
      coins.forEach((coin, id) => {
        if (!coin) return;
        if (t - coin.born > 0.9) {
          coin.vy = Math.max(-240, coin.vy - 200 * dt);
          coin.cy += coin.vy * dt;
          coin.cx += coin.vx * dt;
        }
        if (coin.cy + coin.half < -cell * 2) {
          for (const i of coin.members) {
            coinOf[i] = -1;
            px[i] = homeX[i];
            py[i] = -cell - rand() * cell * 12;
            vx[i] = 0;
            vy[i] = 0;
          }
          coins[id] = null;
        }
      });
      const reach = cell * 22;
      for (let i = 0; i < n; i++) {
        if (t < delay[i]) continue;
        let tx = homeX[i];
        let ty = homeY[i];
        let k = 34;
        const coin = coinOf[i] >= 0 ? coins[coinOf[i]] : null;
        if (coin) {
          const m = coin.members.indexOf(i);
          const sway = Math.sin((t - coin.born) * 2.2 + coin.dx.length) * cell * 0.8 * Math.min(1, Math.max(0, t - coin.born - 0.9));
          tx = coin.cx + coin.dx[m] + sway;
          ty = coin.cy + coin.dy[m];
          k = 60;
        }
        vx[i] += (tx - px[i]) * k * dt;
        vy[i] += (ty - py[i]) * k * dt;
        if (!coin) {
          const dx = px[i] - pointer.x;
          const dy = py[i] - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < reach * reach) {
            const d = Math.sqrt(d2) || 1;
            const push = (1 - d / reach) * 3000 * dt;
            vx[i] += (dx / d) * push;
            vy[i] += (dy / d) * push;
            if (d < reach * 0.3) flash[i] = t + 0.4;
          }
        }
        vx[i] *= 1 - 7 * dt;
        vy[i] *= 1 - 7 * dt;
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
      }
      draw(t);
      raf = requestAnimationFrame(frame);
    };

    const restart = () => {
      cancelAnimationFrame(raf);
      build().then(() => {
        if (!alive) return;
        if (reduced) draw(0);
        else raf = requestAnimationFrame(frame);
      });
    };

    let lastWidth = -1;
    const ro = new ResizeObserver(() => {
      const w = Math.floor(canvas.getBoundingClientRect().width);
      if (w !== lastWidth) {
        lastWidth = w;
        restart();
      }
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
  }, [text]);
  return <canvas ref={ref} className="word" aria-hidden />;
}
