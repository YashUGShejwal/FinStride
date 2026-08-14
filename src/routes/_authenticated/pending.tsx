import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy URL shim — the Pending page's obligations UI now lives under
 * Cash Flow's "Obligations & Dues" tab. This keeps old bookmarks, browser
 * history, and installed-PWA sessions from hard-404ing; it renders nothing.
 */
export const Route = createFileRoute("/_authenticated/pending")({
  beforeLoad: () => {
    throw redirect({ to: "/cashflow", search: { tab: "obligations" }, replace: true });
  },
});
