import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * "The Kinetic Stride" — FinStride's brand mark. A forward-leaning geometric
 * F/S monogram built from three slanted strokes: two bars forming the F, and
 * a swept tail that cuts forward like a stride mid-motion, carrying the
 * neon emerald→cyan gradient.
 *
 * Pass `decorative` when the mark sits next to visible brand text (header
 * lockup, login title, footer) so screen readers don't announce the brand
 * twice; leave it off where the mark is the only brand carrier (auth
 * callback spinner, signup header).
 */
export function LogoMark({
  className,
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  // useId so the gradient id stays unique when several marks render on one
  // page (header + login + footer); colons stripped since the id is consumed
  // through a url(#…) reference.
  const gid = `stride-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "FinStride" })}
    >
      <defs>
        <linearGradient id={gid} x1="4" y1="4" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      {/* Top bar of the F */}
      <path d="M11 4h17l-3 5.4H8L11 4Z" fill={`url(#${gid})`} />
      {/* Crossbar */}
      <path d="M8.4 13.3h13.2l-3 5.4H5.4l3-5.4Z" fill={`url(#${gid})`} opacity="0.9" />
      {/* Kinetic tail — the stride's forward cut */}
      <path d="M5.8 22.6h8.4L25 30H10.4l-4.6-7.4Z" fill={`url(#${gid})`} opacity="0.8" />
    </svg>
  );
}

/**
 * The brand name in Clash Display with the emerald accent dot — the single
 * source for the wordmark so header/login/lockup can never drift apart.
 */
export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display font-semibold tracking-tight leading-none", className)}>
      FinStride<span className="text-primary">.</span>
    </span>
  );
}

/** Mark + wordmark lockup. The mark is decorative here — the wordmark carries the name. */
export function Logo({
  className,
  markClassName = "size-8",
  wordmarkClassName = "text-lg",
}: {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark decorative className={markClassName} />
      <LogoWordmark className={wordmarkClassName} />
    </span>
  );
}
