import { useEffect, useRef, useState } from 'react';

// For sections pinned while you scroll through them: how many of `steps` items should be showing.
// The first appears as soon as the section is pinned, with a short hold after the last.
// On narrow screens (or with no room to pin) everything simply shows.
export function useStepReveal(steps: number) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(0);
  const [pinned, setPinned] = useState(true);
  useEffect(() => {
    const narrow = matchMedia('(max-width: 720px)');
    const onScroll = () => {
      if (narrow.matches) {
        setPinned(false);
        setShown(steps);
        return;
      }
      setPinned(true);
      const r = ref.current!.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight || 1)));
      setShown(progress <= 0 ? 0 : Math.min(steps, Math.floor(progress * (steps + 0.25)) + 1));
    };
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    return () => {
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
    };
  }, [steps]);
  return { ref, shown, pinned };
}
