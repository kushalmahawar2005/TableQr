"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "./dashboard-shared";

/**
 * A rupee amount that counts up to its value when it first shows, and glides to each new value
 * on refresh. Screen readers and reduced-motion users get the final number straight away.
 */
export function CountUpMoney({ paise, duration = 700 }: { paise: number; duration?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const length = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duration;
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = length > 0 ? Math.min(1, (now - start) / length) : 1;
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(begin + (paise - begin) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = paise;
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); from.current = paise; };
  }, [paise, duration]);

  return <><span aria-hidden="true">{money(shown)}</span><span className="sr-only">{money(paise)}</span></>;
}
