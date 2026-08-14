import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy URL shim — the Grind Deck module was retired in the 4-hub overhaul
 * (its historical data is still preserved in backups/sync). This keeps old
 * bookmarks and installed-PWA history from hard-404ing; it renders nothing.
 */
export const Route = createFileRoute("/_authenticated/grind")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", replace: true });
  },
});
