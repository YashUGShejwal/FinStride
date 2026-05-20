import { useEffect, useState } from "react";
import { Download, Share2, Smartphone, X, CheckCircle2, MoreVertical, PlusSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const SEEN_KEY = "finstride.pwa.dismissed";

function isRunningStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true)
  );
}

export function PwaInstallBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(SEEN_KEY) === "1") return;
    if (isRunningStandalone()) return; // already installed — never show

    const ua = navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua) && !/crios|fxios/.test(ua);
    const isAndroid = /android/.test(ua);
    setPlatform(isIOS ? "ios" : isAndroid ? "android" : "desktop");

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setOpen(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // On iOS (no native event) or desktop without prior prompt, show the teaching banner
    if (isIOS) {
      const t = setTimeout(() => setOpen(true), 1800);
      return () => {
        window.removeEventListener("beforeinstallprompt", handler);
        clearTimeout(t);
      };
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
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
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 md:p-6 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-md glass-strong rounded-2xl overflow-hidden animate-in slide-in-from-bottom-8 fade-in duration-500">
        {installed ? (
          <div className="flex items-center gap-3 p-4">
            <div className="size-10 rounded-full gradient-success grid place-items-center shrink-0">
              <CheckCircle2 className="size-6 text-background" />
            </div>
            <div>
              <p className="font-semibold">Added to home screen</p>
              <p className="text-xs text-muted-foreground">FinStride is ready to use as an app.</p>
            </div>
          </div>
        ) : platform === "ios" ? (
          <IOSInstructions onDismiss={dismiss} />
        ) : (
          <AndroidPrompt onInstall={install} onDismiss={dismiss} hasNativePrompt={!!deferred} />
        )}
      </div>
    </div>
  );
}

function IOSInstructions({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="size-11 shrink-0 rounded-xl gradient-primary grid place-items-center glow">
          <Smartphone className="size-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold leading-tight">Add FinStride to Home Screen</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Install as an app for offline-first access.
          </p>
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground shrink-0">
          <X className="size-4" />
        </button>
      </div>

      <ol className="space-y-2 text-sm">
        <li className="flex items-center gap-3">
          <span className="size-6 rounded-full bg-white/10 grid place-items-center text-xs font-semibold shrink-0">1</span>
          <span className="text-muted-foreground">
            Tap the <Share2 className="size-3.5 inline mx-0.5 text-foreground" />{" "}
            <strong className="text-foreground">Share</strong> button in Safari's toolbar
          </span>
        </li>
        <li className="flex items-center gap-3">
          <span className="size-6 rounded-full bg-white/10 grid place-items-center text-xs font-semibold shrink-0">2</span>
          <span className="text-muted-foreground">
            Scroll down and tap{" "}
            <PlusSquare className="size-3.5 inline mx-0.5 text-foreground" />{" "}
            <strong className="text-foreground">Add to Home Screen</strong>
          </span>
        </li>
        <li className="flex items-center gap-3">
          <span className="size-6 rounded-full bg-white/10 grid place-items-center text-xs font-semibold shrink-0">3</span>
          <span className="text-muted-foreground">
            Tap <strong className="text-foreground">Add</strong> — FinStride launches like a native app
          </span>
        </li>
      </ol>

      <Button onClick={onDismiss} variant="secondary" className="w-full h-9 text-sm">
        Got it
      </Button>
    </div>
  );
}

function AndroidPrompt({
  onInstall,
  onDismiss,
  hasNativePrompt,
}: {
  onInstall: () => void;
  onDismiss: () => void;
  hasNativePrompt: boolean;
}) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="size-11 shrink-0 rounded-xl gradient-primary grid place-items-center glow">
          <Smartphone className="size-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold leading-tight">Install FinStride</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasNativePrompt
              ? "One tap to add FinStride to your home screen."
              : "Tap the browser menu and select 'Add to Home Screen'."}
          </p>
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground shrink-0">
          <X className="size-4" />
        </button>
      </div>

      {!hasNativePrompt && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 pl-1">
          <MoreVertical className="size-3.5 shrink-0" />
          Open the browser menu → <strong>Add to Home Screen</strong>
        </p>
      )}

      <div className="flex gap-2">
        <Button onClick={onDismiss} variant="ghost" className="flex-1 h-9 text-sm">
          Later
        </Button>
        {hasNativePrompt && (
          <Button onClick={onInstall} className="flex-1 h-9 text-sm gradient-primary text-primary-foreground border-0 gap-2">
            <Download className="size-4" /> Install
          </Button>
        )}
      </div>
    </div>
  );
}
