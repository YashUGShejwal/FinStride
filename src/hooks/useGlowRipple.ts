import { useEffect, useRef, useState } from "react";

/**
 * One-shot emerald glow pulse for "action succeeded" moments (trade logged,
 * obligation settled). Attach `className` to the element and call `trigger()`
 * on success — the .glow-ripple animation (styles.css) runs once and the
 * class is removed so the next trigger re-fires it.
 */
export function useGlowRipple(): { className: string; trigger: () => void } {
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const trigger = () => {
    if (timer.current) clearTimeout(timer.current);
    // Drop the class for one frame so a rapid second trigger restarts the
    // CSS animation instead of silently continuing the old one.
    setActive(false);
    requestAnimationFrame(() => {
      setActive(true);
      timer.current = setTimeout(() => setActive(false), 750);
    });
  };

  return { className: active ? "glow-ripple" : "", trigger };
}
