import { useDailyQuote } from "@/hooks/useDailyQuote";

const CATEGORY_LABEL: Record<string, string> = {
  ENGINEER: "SYSTEM LOG",
  REALITY:  "REALITY CHECK",
  LEGACY:   "LEGACY NOTE",
};

export function DailyQuoteFooter() {
  const quote = useDailyQuote();

  if (!quote) return null;

  const label = CATEGORY_LABEL[quote.category] ?? "SYSTEM LOG";

  return (
    <footer className="text-muted-foreground/60 text-xs tracking-wide text-center mt-12 pb-6 px-4 max-w-2xl mx-auto select-none">
      <span className="opacity-40 mr-1.5">{label}:</span>
      <span className="italic">&ldquo;{quote.text}&rdquo;</span>
    </footer>
  );
}
