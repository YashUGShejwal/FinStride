import type { ReactNode } from "react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * Wraps a sensitive figure (net worth, balance, trade size, return) so that
 * Stealth Privacy Mode blurs it out. Hovering a blurred value momentarily
 * reveals it; toggling stealth off (header eye / Cmd+Shift+P) reveals all.
 */
export function Sensitive({ children, className }: { children: ReactNode; className?: string }) {
  const { isStealthMode } = useStore();
  return <span className={cn(isStealthMode && "stealth-blur", className)}>{children}</span>;
}
