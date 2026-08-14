import { useRef, type ReactNode, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * Glass card with a cursor-tracking spotlight: a soft emerald radial glow
 * follows the mouse across the card while hovered. Position is written
 * straight to CSS custom properties on the element, so tracking costs zero
 * React re-renders. Builds on the .glass / .kpi-card utilities (hover border
 * warm-up comes from .kpi-card).
 */
export function SpotlightCard({
  className,
  children,
  spotlightColor = "oklch(0.74 0.17 160 / 0.10)",
}: {
  className?: string;
  children: ReactNode;
  /** The glow's center color — override for accent-toned cards. */
  spotlightColor?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${e.clientX - rect.left}px`);
    el.style.setProperty("--spot-y", `${e.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      className={cn("group relative glass kpi-card overflow-hidden", className)}
    >
      {children}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background: `radial-gradient(320px circle at var(--spot-x, 50%) var(--spot-y, 50%), ${spotlightColor}, transparent 65%)`,
        }}
      />
    </div>
  );
}
