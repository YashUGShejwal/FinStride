import { useEffect, useState } from "react";

/**
 * Platform-aware modifier-key label for keyboard-shortcut hints ("⌘" on
 * macOS/iOS, "Ctrl" elsewhere). Resolves to null on the server AND on the
 * first client render — callers should render nothing until it resolves —
 * because navigator only exists client-side and deciding earlier would make
 * SSR and hydration disagree on the hint text.
 */
export function useModKeyLabel(): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const platform = navigator.platform ?? "";
    const isApple = /mac|iphone|ipad|ipod/i.test(platform);
    setLabel(isApple ? "⌘" : "Ctrl");
  }, []);
  return label;
}

/** The `beforeinstallprompt` event — not yet in lib.dom.d.ts. */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * True when the app is currently running as an installed PWA — a standalone
 * window, or (iOS has no `display-mode` match) the home-screen-launch flag
 * Safari sets on `navigator`. Client-only: always false during SSR.
 */
export function isRunningStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      (window.navigator as { standalone?: boolean }).standalone === true)
  );
}
