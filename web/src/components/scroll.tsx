import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// A pinned paragraph that reveals one line per scroll step, then the `after` blocks.
// `link` turns a phrase of the text into an external link.
export function ScrollLines({ text, after, className = '', link }: {
  text: string;
  after?: ReactNode | ReactNode[];
  className?: string;
  link?: { phrase: string; href: string };
}) {
  const afters = Array.isArray(after) ? after : after ? [after] : [];
  const sectionRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const words = text.split(' ');
  const [lineOf, setLineOf] = useState<number[]>([]);
  const [shown, setShown] = useState(0);
  const lines = lineOf.length ? lineOf[lineOf.length - 1] + 1 : 6;
  const steps = lines + (afters.length > 1 ? afters.length : 0);

  useLayoutEffect(() => {
    const measure = () => {
      const spans = [...textRef.current!.querySelectorAll<HTMLElement>('.w')];
      let line = -1;
      let top = -1e9;
      setLineOf(spans.map((s) => {
        if (Math.abs(s.offsetTop - top) > 2) {
          line++;
          top = s.offsetTop;
        }
        return line;
      }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(textRef.current!);
    return () => ro.disconnect();
  }, [text]);

  useEffect(() => {
    const on = () => {
      const r = sectionRef.current!.getBoundingClientRect();
      const span = r.height - innerHeight;
      const p = Math.min(1, Math.max(0, -r.top / (span || 1)));
      setShown(p <= 0 ? 0 : Math.min(steps, Math.floor(p * (steps + 0.25)) + 1));
    };
    on();
    addEventListener('scroll', on, { passive: true });
    addEventListener('resize', on);
    return () => {
      removeEventListener('scroll', on);
      removeEventListener('resize', on);
    };
  }, [steps]);

  const renderWords = () => {
    const cls = (i: number) => ((lineOf[i] ?? 0) < shown ? 'w in' : 'w');
    const word = (i: number, w: string = words[i]) => <span key={i} className={cls(i)}>{w}</span>;
    const phrase = link ? link.phrase.split(' ') : [];
    const bare = (w: string | undefined) => (w ?? '').replace(/[.,;:!?]+$/, '');
    const at = link ? words.findIndex((_, i) => phrase.every((p, j) => bare(words[i + j]) === p)) : -1;
    const out: ReactNode[] = [];
    for (let i = 0; i < words.length; i++) {
      if (i === at) {
        const end = at + phrase.length;
        const tail = words[end - 1].slice(bare(words[end - 1]).length);
        const arrowCls = cls(end - 1) === 'w in' ? 'w-arrow in' : 'w-arrow';
        out.push(
          <span key={`l${i}`} className="link-wrap">
            <a className="lines-link" href={link!.href} target="_blank" rel="noreferrer">
              {phrase.map((p, j) => (
                <Fragment key={j}>
                  {word(at + j, p)}
                  {j < phrase.length - 1 ? <span className={cls(at + j) === 'w in' ? 'w-arrow in' : 'w-arrow'}> </span> : ''}
                </Fragment>
              ))}
              <svg className={`ext ${arrowCls}`} viewBox="0 0 12 12" aria-hidden>
                <path d="M5 2H2v8h8V7M7 2h3v3M10 2 5.5 6.5" />
              </svg>
            </a>
            {tail && <span className={arrowCls}>{tail}</span>}
          </span>,
        );
        i = end - 1;
      } else {
        out.push(word(i));
      }
      if (i < words.length - 1) out.push(' ');
    }
    return out;
  };

  return (
    <section className={`lines ${className}`} ref={sectionRef} style={{ height: `${100 + steps * 28}vh` }}>
      <div className="lines-stage">
        <div className="lines-body">
          <p className="lines-text" ref={textRef}>{renderWords()}</p>
          {afters.length === 1 && <div className={shown >= lines ? 'lines-after in' : 'lines-after'}>{afters[0]}</div>}
          {afters.length > 1 && afters.map((a, i) => (
            <div key={i} className={shown >= lines + i + 1 ? 'lines-after in' : 'lines-after'}>{a}</div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Scroll-driven step counter for a pinned section. On narrow screens nothing is pinned and every
// step shows at once.
export function useScrollSteps(count: number) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(0);
  const [pinned, setPinned] = useState(true);
  useEffect(() => {
    const mq = matchMedia('(max-width: 720px)');
    const on = () => {
      if (mq.matches) {
        setPinned(false);
        setShown(count);
        return;
      }
      setPinned(true);
      const r = ref.current!.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight || 1)));
      setShown(p <= 0 ? 0 : Math.min(count, Math.floor(p * (count + 0.25)) + 1));
    };
    on();
    addEventListener('scroll', on, { passive: true });
    addEventListener('resize', on);
    return () => {
      removeEventListener('scroll', on);
      removeEventListener('resize', on);
    };
  }, [count]);
  return { ref, shown, pinned };
}
