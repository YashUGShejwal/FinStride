import { useEffect } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "framer-motion";

/**
 * Spring-animated numeric ticker for financial figures (net worth, returns,
 * account balances). Counts up from 0 when the store hydrates and springs
 * between values on every update.
 *
 * Renders `format(0)` on the server AND on the first client paint — both
 * sides agree, so hydration never mismatches — then the mount effect springs
 * the value in. The motion value writes straight to the DOM text node, so
 * per-frame updates never re-render the React tree.
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString("en-IN"),
  className,
}: {
  value: number;
  /** Turns the in-flight numeric value into display text (e.g. inr). */
  format?: (n: number) => string;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const spring = useSpring(0, { stiffness: 90, damping: 24, mass: 0.9 });
  const display = useTransform(spring, (v) => format(v));

  useEffect(() => {
    if (reducedMotion) spring.jump(value);
    else spring.set(value);
  }, [spring, value, reducedMotion]);

  return <motion.span className={className}>{display}</motion.span>;
}
