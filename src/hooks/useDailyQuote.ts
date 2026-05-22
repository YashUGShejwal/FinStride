import { useEffect, useState } from "react";
import { FINSTRIDE_QUOTES, type MotivationQuote } from "@/lib/quotes";

const DATE_KEY  = "finstride.quote.date";
const INDEX_KEY = "finstride.quote.index";

/**
 * Returns today's quote, stable for the entire calendar day.
 * Initialises to null to avoid SSR/hydration mismatches — the real
 * value is only resolved inside useEffect (client-side only).
 */
export function useDailyQuote(): MotivationQuote | null {
  const [quote, setQuote] = useState<MotivationQuote | null>(null);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

    try {
      const savedDate  = localStorage.getItem(DATE_KEY);
      const savedIndex = localStorage.getItem(INDEX_KEY);

      if (savedDate === today && savedIndex !== null) {
        const idx = Number(savedIndex);
        if (idx >= 0 && idx < FINSTRIDE_QUOTES.length) {
          setQuote(FINSTRIDE_QUOTES[idx]);
          return;
        }
      }

      // New day (or first visit) — pick a random quote
      const newIndex = Math.floor(Math.random() * FINSTRIDE_QUOTES.length);
      localStorage.setItem(DATE_KEY,  today);
      localStorage.setItem(INDEX_KEY, String(newIndex));
      setQuote(FINSTRIDE_QUOTES[newIndex]);
    } catch {
      // localStorage unavailable (private mode, etc.) — fall back to index 0
      setQuote(FINSTRIDE_QUOTES[0]);
    }
  }, []);

  return quote;
}
