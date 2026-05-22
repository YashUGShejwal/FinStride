import { useEffect, useState } from "react";
import { FINSTRIDE_QUOTES, type MotivationQuote } from "@/lib/quotes";

const OWNER_EMAIL = "test78@gmail.com"; // swap for your real email

const DATE_KEY = "finstride.quote.date";
const ID_KEY   = "finstride.quote.id";  // stores quote.id, not array index

/**
 * Returns today's quote for the given user, stable for the full calendar day.
 * - Owner sees ALL quotes (PERSONAL + GENERAL).
 * - Any other user sees only GENERAL quotes.
 * - The selected quote id is persisted to localStorage so:
 *   (a) the same quote shows all day, and
 *   (b) re-ordering the array never causes the wrong quote to appear.
 *
 * Returns null on first render (SSR-safe hydration — no localStorage on server).
 */
export function useDailyQuote(userEmail: string): MotivationQuote | null {
  const [quote, setQuote] = useState<MotivationQuote | null>(null);

  useEffect(() => {
    if (!userEmail) return; // wait until auth has resolved

    const pool =
      userEmail === OWNER_EMAIL
        ? FINSTRIDE_QUOTES
        : FINSTRIDE_QUOTES.filter((q) => q.audience === "GENERAL");

    if (pool.length === 0) return;

    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

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
        // Saved quote not in this user's pool (shouldn't normally happen) — fall through to re-pick
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
  }, [userEmail]);

  return quote;
}
