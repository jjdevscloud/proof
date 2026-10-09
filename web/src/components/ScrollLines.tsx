import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// One ordinary paragraph pinned in the middle of the screen. As you scroll through the section, the
// lines it wraps onto appear one after another, top to bottom. `after` shows once the last line is in;
// if it is a list, its items appear one by one after that.
// `link` turns a phrase in the text into a link, marked with a small arrow.
// `eager` starts the reveal from the top of the page, so the first line shows straight away (for a page that opens on it).
export function ScrollLines({ text, after, className = '', link, eager = false }: { text: string; after?: ReactNode | ReactNode[]; className?: string; link?: { phrase: string; href: string }; eager?: boolean }) {
  const extras = Array.isArray(after) ? after : after ? [after] : [];
  const ref = useRef<HTMLElement>(null);
  const para = useRef<HTMLParagraphElement>(null);
  const words = text.split(' ');
  const [lineOf, setLineOf] = useState<number[]>([]);
  const [shown, setShown] = useState(0);
  const lines = lineOf.length ? lineOf[lineOf.length - 1] + 1 : 6;
  const steps = lines + (extras.length > 1 ? extras.length : 0);

  // Work out which wrapped line each word landed on; redo it whenever the paragraph reflows.
  useLayoutEffect(() => {
    const measure = () => {
      const spans = [...para.current!.querySelectorAll<HTMLSpanElement>('.w')];
      let line = -1, top = -1e9;
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
    ro.observe(para.current!);
    return () => ro.disconnect();
  }, [text]);

  useEffect(() => {
    const onScroll = () => {
      const r = ref.current!.getBoundingClientRect();
      const travel = r.height - innerHeight;
      if (eager) {
        const start = r.top + scrollY;
        const p = Math.min(1, Math.max(0, scrollY / (start + travel || 1)));
        setShown(Math.min(steps, Math.floor(p * (steps + 0.25)) + 1));
        return;
      }
      const progress = Math.min(1, Math.max(0, -r.top / (travel || 1)));
      // First line as soon as the paragraph is pinned; a short hold after the last before it lets go.
      setShown(progress <= 0 ? 0 : Math.min(steps, Math.floor(progress * (steps + 0.25)) + 1));
    };
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    return () => {
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
    };
  }, [steps, eager]);

  return (
    <section className={`lines ${className}`} ref={ref} style={{ height: `${100 + steps * 28}vh` }}>
      <div className="lines-stage">
        <div className="lines-body">
          <p className="lines-text" ref={para}>
            {(() => {
              const cls = (i: number) => ((lineOf[i] ?? 0) < shown ? 'w in' : 'w');
              const span = (i: number, text = words[i]) => <span key={i} className={cls(i)}>{text}</span>;
              const lw = link ? link.phrase.split(' ') : [];
              const bare = (w?: string) => (w ?? '').replace(/[.,;:!?]+$/, '');
              const at = link ? words.findIndex((_, i) => lw.every((x, j) => bare(words[i + j]) === x)) : -1;
              const out: ReactNode[] = [];
              for (let i = 0; i < words.length; i++) {
                if (i === at) {
                  const end = at + lw.length;
                  const tail = words[end - 1].slice(bare(words[end - 1]).length);
                  const fade = (cls(end - 1) === 'w in' ? 'w-arrow in' : 'w-arrow');
                  out.push(
                    <span key={`l${i}`} className="link-wrap">
                    <a className="lines-link" href={link!.href} target="_blank" rel="noreferrer">
                      {lw.map((x, j) => (
                        <Fragment key={j}>
                          {span(at + j, x)}
                          {j < lw.length - 1 ? <span className={cls(at + j) === 'w in' ? 'w-arrow in' : 'w-arrow'}> </span> : ''}
                        </Fragment>
                      ))}
                      <svg className={`ext ${fade}`} viewBox="0 0 12 12" aria-hidden><path d="M5 2H2v8h8V7M7 2h3v3M10 2 5.5 6.5" /></svg>
                    </a>
                    {tail && <span className={fade}>{tail}</span>}
                    </span>,
                  );
                  i = end - 1;
                } else out.push(span(i));
                if (i < words.length - 1) out.push(' ');
              }
              return out;
            })()}
          </p>
          {extras.length === 1 && <div className={shown >= lines ? 'lines-after in' : 'lines-after'}>{extras[0]}</div>}
          {extras.length > 1 && extras.map((x, i) => (
            <div key={i} className={shown >= lines + i + 1 ? 'lines-after in' : 'lines-after'}>{x}</div>
          ))}
        </div>
      </div>
    </section>
  );
}
