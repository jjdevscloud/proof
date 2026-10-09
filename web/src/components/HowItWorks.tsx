import type React from 'react';
import { Fragment, useEffect, useRef, useState } from 'react';

// How it works, step by step: buy, seal, list or sell, roll, on a line that draws as you scroll. Display only.

// DRAFT copy, awaiting approval.
const STEPS: { title: string; text: string }[] = [
  { title: 'Buy', text: 'On the curve every token gets a number and some Strikes are rare. After the curve tokens are ordinary.' },
  { title: 'Seal', text: 'Seal tokens in an envelope to keep their rarity intact.' },
  { title: 'List or sell', text: 'List the envelope for collectors, or sell on an exchange and rare tokens melt.' },
  { title: 'Roll', text: 'Roll ordinary $PROOF for one of ten rolled tiers.' },
];

// The two paths: how many of the steps each one runs. Buying on the curve is the main path; after the
// curve is drawn lighter and smaller, as the second way in.
const TRACKS = [
  { label: 'On the curve', steps: 3, minor: false },
  { label: 'After the curve', steps: 4, minor: true },
];

export function HowItWorks() {
  // Scroll driven: the section holds still while you scroll through it, and the line draws left to
  // right. Each square fills as the line reaches it and that step's words come in. On narrow screens,
  // or with reduced motion, everything simply shows.
  const ref = useRef<HTMLElement>(null);
  const [p, setP] = useState(0);
  const [pinned, setPinned] = useState(true);
  useEffect(() => {
    const narrow = matchMedia('(max-width: 720px)');
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    const onScroll = () => {
      if (narrow.matches || still.matches) {
        setPinned(false);
        setP(1);
        return;
      }
      setPinned(true);
      const r = ref.current!.getBoundingClientRect();
      const raw = -r.top / (r.height - innerHeight || 1);
      // A short pause before the line starts, and a hold at the end once Roll is reached.
      setP(Math.min(1, Math.max(0, (raw - 0.08) / 0.78)));
    };
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    return () => {
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
    };
  }, []);
  // In two stages: the on the curve line draws first, over the first 45% of the scroll; after a short
  // pause the after the curve line draws, over the rest. `ats` is how far each line has got, in steps.
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const ats = [clamp(p / 0.45) * (TRACKS[0].steps - 1), clamp((p - 0.52) / 0.48) * (TRACKS[1].steps - 1)];
  const started = [p > 0, p > 0.52];
  const onTrack = (t: number, i: number) => started[t] && ats[t] >= i - 0.001;
  // A step's title and words come in when either line reaches it.
  const reached = (i: number) => onTrack(0, i) || onTrack(1, i);
  return (
    <section className={pinned ? 'how how-scroll' : 'how'} ref={ref}>
      <div className={pinned ? 'how-stage' : undefined}>
      {/* DRAFT heading and line, awaiting approval. */}
      <h2>How it works</h2>
      <p>From buying on the curve to rolling after it.</p>

      {/* Two paths on one grid: bought on the curve runs Buy, Seal, List or sell; bought after the curve
          runs the same three and then Roll. Titles on top, the two lines in the middle, the words below. */}
      <div className="frame how-frame">
      <div className="how-grid">
        <span />
        {STEPS.map((s, i) => (
          <div key={s.title} className={reached(i) ? 'how-head in' : 'how-head'}>
            <span className="how-n">{String(i + 1).padStart(2, '0')}</span>
            <strong>{s.title}</strong>
          </div>
        ))}
        {TRACKS.map((t, ti) => (
          <Fragment key={t.label}>
            {/* DRAFT labels, awaiting approval. */}
            <span className={`how-track${t.minor ? ' minor' : ''}${started[ti] ? ' in' : ''}`}>{t.label}</span>
            {STEPS.map((s, i) => {
              if (i >= t.steps) return <span key={s.title} />;
              const last = i === t.steps - 1;
              return (
                <span key={s.title} className={`how-node${t.minor ? ' minor' : ''}${onTrack(ti, i) ? ' in' : ''}`} style={{ '--fill': last ? 0 : clamp(ats[ti] - i) } as React.CSSProperties} data-last={last || undefined} aria-hidden>
                  {i === STEPS.length - 1 ? (
                    // Roll ends on a die: five pips, filled once the line reaches it.
                    <svg className="how-die" viewBox="0 0 16 16" shapeRendering="crispEdges">
                      <rect x="0.5" y="0.5" width="15" height="15" />
                      {[[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]].map(([x, y]) => <rect key={`${x},${y}`} className="pip" x={x} y={y} width={2} height={2} />)}
                    </svg>
                  ) : <i />}
                </span>
              );
            })}
          </Fragment>
        ))}
        <span />
        {STEPS.map((s, i) => <span key={s.title} className={reached(i) ? 'how-text in' : 'how-text'}>{s.text}</span>)}
      </div>
      </div>

      <a className="btn btn-primary how-more" href="#/traits">See every trait</a>
      </div>
    </section>
  );
}
