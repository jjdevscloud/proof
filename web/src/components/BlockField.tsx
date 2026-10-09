import { useEffect, useRef } from 'react';

// A full-width field of blocks closing the page: dense at the bottom, dissolving upward, its edge
// slowly drifting. A few blocks carry the rarity colours; blocks near the cursor push away and flash
// purple. Decorative only.
const CELL = 9;

export function BlockField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, cols = 0, rows = 0, dpr = 1, raf = 0, alive = true;
    let tone = new Uint8Array(0), seed = new Float32Array(0);
    const pointer = { x: -1e4, y: -1e4 };
    const start = performance.now();

    const size = () => {
      // Span the visible page exactly, edge to edge (the window width minus the scrollbar).
      const pageW = document.documentElement.clientWidth;
      canvas.style.width = `${pageW}px`;
      canvas.style.marginLeft = '0px';
      canvas.style.marginLeft = `${-canvas.getBoundingClientRect().left}px`;
      w = pageW;
      h = Math.floor(canvas.getBoundingClientRect().height);
      cols = Math.ceil(w / CELL) + 1;
      rows = Math.ceil(h / CELL);
      dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      // A fixed character for every cell: its own threshold jitter, and whether it carries a colour.
      tone = new Uint8Array(cols * rows);
      seed = new Float32Array(cols * rows);
      let s = 11;
      const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < cols * rows; i++) {
        seed[i] = rnd();
        const r = rnd();
        tone[i] = r < 0.03 ? 1 : r < 0.05 ? 2 : r < 0.07 ? 3 : 0;
      }
    };

    const frame = (now: number) => {
      const t = still ? 0 : (now - start) / 1000;
      const css = getComputedStyle(canvas);
      const colours = ['--word', '--word-2', '--word-3', '--word-4'].map((v) => css.getPropertyValue(v).trim());
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const reach = CELL * 11;
      const ox = (w - cols * CELL + 2) / 2; // centre the grid so both edges match
      const b = CELL - 2;
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = colours[k];
        for (let y = 0; y < rows; y++) {
          // Density rises toward the bottom; a slow wave moves the dissolving edge.
          const depth = y / (rows - 1);
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            // Measured from the centre, so the two halves mirror and the field sits centred.
            const u = Math.abs(x - (cols - 1) / 2);
            const wave = 0.16 * Math.sin(u * 0.045 - t * 0.35) + 0.08 * Math.sin(u * 0.11 + t * 0.5 + y * 0.05);
            const density = Math.pow(Math.max(0, depth + wave), 1.7);
            if (seed[i] > density) continue;
            let px = ox + x * CELL, py = y * CELL, kind = tone[i];
            const dx = px - pointer.x, dy = py - pointer.y;
            const d = Math.hypot(dx, dy);
            if (d < reach) {
              const push = (1 - d / reach) * CELL * 2.4;
              px += (dx / (d || 1)) * push;
              py += (dy / (d || 1)) * push;
              if (d < reach * 0.4) kind = 1;
            }
            if (kind === k) ctx.fillRect(Math.round(px), Math.round(py), b, b);
          }
        }
      }
      if (alive && !still) raf = requestAnimationFrame(frame);
    };

    size();
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => {
      size();
      if (still) requestAnimationFrame(frame);
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
