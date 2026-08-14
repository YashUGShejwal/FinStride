import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { useDailyQuote } from "@/hooks/useDailyQuote";
import { LogoMark } from "@/components/Logo";

export function DailyQuoteFooter() {
  const { user } = useAuth();
  const { showPersonalQuotes } = useStore();
  const quote = useDailyQuote(showPersonalQuotes);

  // Don't render until auth has resolved and a quote has been selected
  if (!user || !quote) return null;

  return (
    <footer className="text-muted-foreground/60 text-xs tracking-wide text-center mt-12 pb-6 px-4 max-w-2xl mx-auto select-none">
      <LogoMark decorative className="size-4 mx-auto mb-2 opacity-40" />
      <span className="opacity-50">Thought of the day: </span>
      <span className="italic">&ldquo;{quote.text}&rdquo;</span>
    </footer>
  );
}
