import { useEffect, useState } from "react";
import { FINSTRIDE_QUOTES, type MotivationQuote } from "@/lib/quotes";
import { todayLocalISO } from "@/lib/format";

const DATE_KEY = "finstride.quote.date";
const ID_KEY   = "finstride.quote.id";  // stores quote.id, not array index

/**
 * Returns today's quote, stable for the full calendar day.
 * - showPersonal=true sees ALL quotes (PERSONAL + GENERAL) — driven by the
 *   "Show personal quotes" setting, not a hardcoded owner identity.
 * - showPersonal=false sees only GENERAL quotes.
 * - The selected quote id is persisted to localStorage so:
 *   (a) the same quote shows all day, and
 *   (b) re-ordering the array never causes the wrong quote to appear.
 *
 * Returns null on first render (SSR-safe hydration — no localStorage on server).
 */
export function useDailyQuote(showPersonal: boolean): MotivationQuote | null {
  const [quote, setQuote] = useState<MotivationQuote | null>(null);

  useEffect(() => {
    const pool = showPersonal
      ? FINSTRIDE_QUOTES
      : FINSTRIDE_QUOTES.filter((q) => q.audience === "GENERAL");

    if (pool.length === 0) return;

    const today = todayLocalISO();

    try {
      const savedDate = localStorage.getItem(DATE_KEY);
      const savedId   = localStorage.getItem(ID_KEY);

      if (savedDate === today && savedId) {
        // Look up the saved id in today's eligible pool
        const cached = pool.find((q) => q.id === savedId);
        if (cached) {
          setQuote(cached);
          return;
        }
        // Saved quote not in this pool (e.g. setting just changed) — fall through to re-pick
      }

      // New day or no valid cached quote — pick randomly from the pool
      const newQuote = pool[Math.floor(Math.random() * pool.length)];
      localStorage.setItem(DATE_KEY, today);
      localStorage.setItem(ID_KEY, newQuote.id);
      setQuote(newQuote);
    } catch {
      // localStorage unavailable (private mode, etc.) — use first eligible quote
      setQuote(pool[0]);
    }
  }, [showPersonal]);

  return quote;
}
