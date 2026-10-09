import { useEffect, useRef } from 'react';

// The site title built from black blocks. Every few seconds, somewhere in the word, a solid pixel
// envelope is found that fits entirely inside a letter's stroke (lying flat in a bar, standing up in a
// stem, or tilted along a diagonal). Exactly those blocks light up, lift out together in that shape and
// float away, leaving an envelope-shaped gap that then fills back in. Blocks pushed by the cursor show
// purple for a moment. Decorative only: the canvas is hidden from screen readers.

type Envelope = {
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

// A solid envelope W x H cells (flap carved as a V), turned by `angle`, as cell offsets from its centre.
export function envelopeShape(W: number, H: number, angle: number): [number, number][] {
  const c = Math.cos(angle), sn = Math.sin(angle);
  const hw = (W - 1) / 2, hh = (H - 1) / 2;
  const top = -hh, apex = -hh + (H - 1) * 0.6;
  const toSeg = (u: number, v: number, x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1, dy = y2 - y1;
    const k = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(u - x1 - k * dx, v - y1 - k * dy);
  };
  const R = Math.ceil(Math.hypot(W, H) / 2) + 1;
  const out: [number, number][] = [];
  for (let dr = -R; dr <= R; dr++) {
    for (let dc = -R; dc <= R; dc++) {
      const u = dc * c + dr * sn, v = -dc * sn + dr * c;
      if (Math.abs(u) > hw + 0.35 || Math.abs(v) > hh + 0.35) continue;
      const rim = Math.abs(u) > hw - 0.6 || v < top + 0.6;
      const flap = Math.min(toSeg(u, v, -hw, top, 0, apex), toSeg(u, v, hw, top, 0, apex)) < 0.5;
      if (rim || !flap) out.push([dc, dr]);
    }
  }
  return out;
}

// One size for every envelope: the size that fits the word's strokes in every direction.
export const ENV_W = 7, ENV_H = 5;
const ZONES = 16;
const ANGLES = [0, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, Math.PI];

// `sizeAs` sizes the letters as if the word were that text, so several lines can share one size.
export function HeroWord({ text, sizeAs }: { text: string; sizeAs?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let alive = true;
    let built = false;
    let w = 0, h = 0, s = 6, dpr = 1, n = 0;
    let hx = new Float32Array(0), hy = new Float32Array(0);
    let px = new Float32Array(0), py = new Float32Array(0);
    let vx = new Float32Array(0), vy = new Float32Array(0);
    let delay = new Float32Array(0), pushed = new Float32Array(0);
    let env = new Int32Array(0), cellOf = new Int32Array(0);
    let cols = 0, rows = 0;
    let envelopes: (Envelope | null)[] = [];
    let start = performance.now(), last = start, nextEnvelope = 2.6;
    // How many envelopes may be in the air at once: one or two, never more.
    let target = 1, retarget = 2.6, lastColour = 0;
    // When each vertical zone of the word last gave up an envelope.
    const zoneUsed = Array.from({ length: ZONES }, () => -1e9 - Math.random() * 100);
    const pointer = { x: -1e4, y: -1e4 };

    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    const build = async () => {
      const css = getComputedStyle(canvas);
      const font = css.getPropertyValue('--word-font').trim() || '400 100px monospace';
      const stretch = parseFloat(css.getPropertyValue('--word-stretch')) || 1;
      await document.fonts.load(font, text).catch(() => {});
      if (!alive) return;
      w = Math.floor(canvas.getBoundingClientRect().width) || canvas.parentElement!.clientWidth;
      s = w < 500 ? 3 : w < 900 ? 5 : 7;
      // Room above the word for envelopes to float through.
      const padTop = s * 10, padBottom = s * 4;

      const probe = document.createElement('canvas').getContext('2d')!;
      probe.font = font;
      const m = probe.measureText(sizeAs ?? text);
      const size = (100 * w) / (m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
      const sized = font.replace(/\d+px/, `${size}px`);
      probe.font = sized;
      const mm = probe.measureText(text);
      const asc = mm.actualBoundingBoxAscent;
      // A Q's tail is cut back to end on the same line as the other letters, so only their depth counts.
      const qAt = text.indexOf('Q');
      const desc = qAt >= 0 ? probe.measureText(text.replace('Q', 'O')).actualBoundingBoxDescent : mm.actualBoundingBoxDescent;
      h = Math.ceil((asc + desc) * stretch) + padTop + padBottom;

      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const o = off.getContext('2d')!;
      o.font = sized;
      o.translate(0, padTop);
      o.scale(1, stretch);
      o.fillText(text, mm.actualBoundingBoxLeft, asc);
      if (qAt >= 0) {
        // Clear everything below the other letters, then draw a short diagonal tail across the bottom
        // right of the bowl that ends on that line.
        const cut = asc + desc;
        o.clearRect(-w, cut, w * 3, h);
        const before = probe.measureText(text.slice(0, qAt)).width;
        const qw = probe.measureText('Q').width;
        const qx = mm.actualBoundingBoxLeft + before;
        const stroke = qw * 0.2;
        o.save();
        o.beginPath();
        o.rect(-w, -padTop, w * 3, cut + padTop);
        o.clip();
        o.lineWidth = stroke;
        o.beginPath();
        o.moveTo(qx + qw * 0.5, cut - (asc + desc) * 0.3);
        o.lineTo(qx + qw * 1.06, cut + stroke * 0.6);
        o.stroke();
        o.restore();
      }
      const data = o.getImageData(0, 0, w, h).data;

      const xs: number[] = [], ys: number[] = [];
      for (let y = 0; y + s <= h; y += s) {
        for (let x = 0; x + s <= w; x += s) {
          if (data[((y + (s >> 1)) * w + x + (s >> 1)) * 4 + 3] > 110) {
            xs.push(x);
            ys.push(y);
          }
        }
      }
      n = xs.length;
      hx = Float32Array.from(xs);
      hy = Float32Array.from(ys);
      px = new Float32Array(n);
      py = new Float32Array(n);
      vx = new Float32Array(n);
      vy = new Float32Array(n);
      delay = new Float32Array(n);
      pushed = new Float32Array(n);
      env = new Int32Array(n).fill(-1);
      cols = Math.floor(w / s) + 1;
      rows = Math.floor(h / s) + 1;
      cellOf = new Int32Array(cols * rows).fill(-1);
      for (let i = 0; i < n; i++) cellOf[(hy[i] / s) * cols + hx[i] / s] = i;
      envelopes = [];
      seed = 7;
      const intro = !still && !built;
      for (let i = 0; i < n; i++) {
        // First load: blocks fly in from the left, column by column. Later resizes just reflow.
        px[i] = intro ? -rnd() * w * 0.5 : hx[i];
        py[i] = intro ? rnd() * h : hy[i];
        delay[i] = intro ? (hx[i] / w) * 1.1 + rnd() * 0.35 : 0;
      }
      dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.height = `${h}px`;
      if (!built) start = performance.now();
      last = performance.now();
      built = true;
    };

    const launch = (t: number) => {
      // Take the next envelope from one of the zones that has gone longest without one, at a truly
      // random spot and direction, so they come from all over the word and never fall into a loop.
      const order = zoneUsed.map((u, z) => [u, z]).sort((p, q) => p[0] - q[0]);
      const zone = order[Math.floor(Math.random() * 4)][1];
      const x0 = (zone / ZONES) * w, x1 = ((zone + 1) / ZONES) * w;
      const inZone: number[] = [];
      for (let i = 0; i < n; i++) if (hx[i] >= x0 && hx[i] < x1) inZone.push(i);
      for (let attempt = 0; attempt < 3; attempt++) {
        const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)];
        const shape = envelopeShape(ENV_W, ENV_H, angle);
        for (let tries = 0; tries < 120 && inZone.length; tries++) {
          const a = inZone[Math.floor(Math.random() * inZone.length)];
          const c0 = hx[a] / s, r0 = hy[a] / s;
          const members: number[] = [];
          let fits = true;
          for (const [dc, dr] of shape) {
            const c = c0 + dc, r = r0 + dr;
            const i = c >= 0 && c < cols && r >= 0 && r < rows ? cellOf[r * cols + c] : -1;
            if (i < 0 || env[i] !== -1 || t < delay[i] || Math.abs(px[i] - hx[i]) + Math.abs(py[i] - hy[i]) > s) {
              fits = false;
              break;
            }
            members.push(i);
          }
          if (!fits) continue;
          const id = envelopes.length;
          envelopes.push({
            members,
            dx: Float32Array.from(members.map((i) => hx[i] - hx[a])),
            dy: Float32Array.from(members.map((i) => hy[i] - hy[a])),
            cx: hx[a],
            cy: hy[a],
            vx: (Math.random() - 0.5) * 30,
            vy: 0,
            born: t,
            colour: (lastColour = 1 + ((lastColour + Math.floor(Math.random() * 2)) % 3)),
            half: Math.max(...members.map((i) => Math.abs(hy[i] - hy[a]))) + s,
          });
          for (const i of members) env[i] = id;
          zoneUsed[zone] = t;
          return;
        }
      }
      zoneUsed[zone] = t;
    };

    const paint = (t: number) => {
      const css = getComputedStyle(canvas);
      const colours = ['--word', '--word-2', '--word-3', '--word-4'].map((v) => css.getPropertyValue(v).trim());
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const size = s - 1;
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = colours[k];
        for (let i = 0; i < n; i++) {
          const e = env[i] >= 0 ? envelopes[env[i]] : null;
          const kind = e ? (t - e.born > 0.15 ? e.colour : 0) : pushed[i] > t ? 1 : 0;
          if (kind === k) ctx.fillRect(Math.round(px[i]), Math.round(py[i]), size, size);
        }
      }
    };

    const frame = (now: number) => {
      const t = (now - start) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (t > retarget) {
        target = Math.random() < 0.5 ? 1 : 2;
        retarget = t + 4 + Math.random() * 3;
      }
      const active = envelopes.reduce((count, e) => count + (e ? 1 : 0), 0);
      if (t > nextEnvelope && active < target) {
        launch(t);
        nextEnvelope = t + 1.1 + Math.random() * 0.9;
      }
      // Envelopes gather, hold, then float up and away; their blocks return to the word.
      envelopes.forEach((e, id) => {
        if (!e) return;
        const age = t - e.born;
        if (age > 0.9) {
          e.vy = Math.max(-240, e.vy - 200 * dt);
          e.cy += e.vy * dt;
          e.cx += e.vx * dt;
        }
        if (e.cy + e.half < -s * 2) {
          for (const i of e.members) {
            env[i] = -1;
            px[i] = hx[i];
            py[i] = -s - rnd() * s * 12;
            vx[i] = 0;
            vy[i] = 0;
          }
          envelopes[id] = null;
        }
      });

      const reach = s * 22;
      for (let i = 0; i < n; i++) {
        if (t < delay[i]) continue;
        let tx = hx[i], ty = hy[i], k = 34;
        const e = env[i] >= 0 ? envelopes[env[i]] : null;
        if (e) {
          const j = e.members.indexOf(i);
          const sway = Math.sin((t - e.born) * 2.2 + e.dx.length) * s * 0.8 * Math.min(1, Math.max(0, t - e.born - 0.9));
          tx = e.cx + e.dx[j] + sway;
          ty = e.cy + e.dy[j];
          k = 60;
        }
        vx[i] += (tx - px[i]) * k * dt;
        vy[i] += (ty - py[i]) * k * dt;
        if (!e) {
          const dx = px[i] - pointer.x, dy = py[i] - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < reach * reach) {
            const d = Math.sqrt(d2) || 1;
            const f = (1 - d / reach) * 3000 * dt;
            vx[i] += (dx / d) * f;
            vy[i] += (dy / d) * f;
            // The push reaches wide; only the blocks right under the cursor flash purple.
            if (d < reach * 0.3) pushed[i] = t + 0.4;
          }
        }
        vx[i] *= 1 - 7 * dt;
        vy[i] *= 1 - 7 * dt;
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
      }
      paint(t);
      raf = requestAnimationFrame(frame);
    };

    const restart = () => {
      cancelAnimationFrame(raf);
      build().then(() => {
        if (!alive) return;
        if (still) paint(0);
        else raf = requestAnimationFrame(frame);
      });
    };
    let lastW = -1;
    const ro = new ResizeObserver(() => {
      const nw = Math.floor(canvas.getBoundingClientRect().width);
      if (nw !== lastW) {
        lastW = nw;
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
  }, [text, sizeAs]);

  return <canvas ref={ref} className="word" aria-hidden />;
}
