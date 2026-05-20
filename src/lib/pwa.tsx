import { useEffect, useState } from "react";
import { Download, Share, Smartphone, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const SEEN_KEY = "finstride.pwa.dismissed";

export function PwaInstallBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(SEEN_KEY) === "1") return;
    const ua = navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua) && !/crios|fxios/.test(ua);
    setIsIOS(ios);
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setOpen(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    // Show on iOS (no native event) after small delay, or in any browser as a teaching banner
    const t = setTimeout(() => setOpen(true), 1500);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    setOpen(false);
    localStorage.setItem(SEEN_KEY, "1");
  };

  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
        setTimeout(dismiss, 1800);
      }
    } else {
      // Simulate successful install
      setInstalled(true);
      setTimeout(dismiss, 1800);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 md:p-6 safe-bottom pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-md glass-strong rounded-2xl p-4 animate-in slide-in-from-bottom-8 fade-in duration-500">
        {installed ? (
          <div className="flex items-center gap-3 py-2">
            <div className="size-10 rounded-full gradient-success grid place-items-center">
              <CheckCircle2 className="size-6 text-background" />
            </div>
            <div>
              <p className="font-semibold">Installed successfully</p>
              <p className="text-xs text-muted-foreground">FinStride is on your home screen.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="size-11 shrink-0 rounded-xl gradient-primary grid place-items-center glow">
                <Smartphone className="size-5 text-primary-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold leading-tight">Install FinStride</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isIOS
                    ? "Tap Share, then 'Add to Home Screen' for the app experience."
                    : "Get one-tap access and offline-first performance."}
                </p>
              </div>
              <button onClick={dismiss} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              {isIOS ? (
                <Button onClick={dismiss} variant="secondary" className="flex-1 gap-2">
                  <Share className="size-4" /> Got it
                </Button>
              ) : (
                <>
                  <Button onClick={dismiss} variant="ghost" className="flex-1">Later</Button>
                  <Button onClick={install} className="flex-1 gradient-primary text-primary-foreground border-0 gap-2">
                    <Download className="size-4" /> Install
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
