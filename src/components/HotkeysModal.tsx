import { useModKeyLabel } from "@/lib/platform";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Hotkey = { keys: string[]; label: string };

/**
 * Keyboard shortcut cheat sheet, opened by the global "?" listener in the
 * workstation shell. Purely presentational — the shell owns open state and
 * the actual key bindings; this just documents them.
 */
export function HotkeysModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const modKey = useModKeyLabel() ?? "Ctrl";

  const groups: { heading: string; keys: Hotkey[] }[] = [
    {
      heading: "Global",
      keys: [
        { keys: [modKey, "K"], label: "Open command palette" },
        { keys: [modKey, "Shift", "P"], label: "Toggle stealth privacy mode" },
        { keys: ["?"], label: "Show this cheat sheet" },
      ],
    },
    {
      heading: "Quick log",
      keys: [
        { keys: ["N"], label: "New transaction" },
        { keys: ["T"], label: "New swing trade" },
        { keys: ["S"], label: "New portfolio snapshot" },
      ],
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-glass-border max-w-sm">
        <DialogTitle className="font-display font-semibold tracking-tight">
          Keyboard shortcuts
        </DialogTitle>
        <DialogDescription className="sr-only">
          All keyboard shortcuts available in FinStride.
        </DialogDescription>

        <div className="space-y-5 mt-1">
          {groups.map((g) => (
            <div key={g.heading}>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                {g.heading}
              </p>
              <ul className="space-y-2">
                {g.keys.map((hk) => (
                  <li key={hk.label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{hk.label}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {hk.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="min-w-[1.75rem] text-center px-1.5 py-1 rounded-md border border-glass-border bg-white/5 text-xs font-medium tnum"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground/70 mt-2">
          Single-letter shortcuts are ignored while typing in a field.
        </p>
      </DialogContent>
    </Dialog>
  );
}
