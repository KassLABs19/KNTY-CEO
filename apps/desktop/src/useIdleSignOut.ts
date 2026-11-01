import { useEffect, useRef } from 'react';

/** Calls onIdle after `minutes` with no mouse, keyboard, touch or scroll activity. */
export function useIdleSignOut(active: boolean, minutes: number, onIdle: () => void) {
  const cb = useRef(onIdle);
  cb.current = onIdle;
  useEffect(() => {
    if (!active) return;
    let timer = window.setTimeout(() => cb.current(), minutes * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => cb.current(), minutes * 60_000);
    };
    const events = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [active, minutes]);
}
