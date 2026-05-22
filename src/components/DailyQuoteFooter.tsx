import { useAuth } from "@/lib/auth";
import { useDailyQuote } from "@/hooks/useDailyQuote";

export function DailyQuoteFooter() {
  const { user } = useAuth();
  const quote = useDailyQuote(user?.email ?? "");

  // Don't render until auth has resolved and a quote has been selected
  if (!user || !quote) return null;

  return (
    <footer className="text-muted-foreground/60 text-xs tracking-wide text-center mt-12 pb-6 px-4 max-w-2xl mx-auto select-none">
      <span className="opacity-50">Thought of the day: </span>
      <span className="italic">&ldquo;{quote.text}&rdquo;</span>
    </footer>
  );
}
