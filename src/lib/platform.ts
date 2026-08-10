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
