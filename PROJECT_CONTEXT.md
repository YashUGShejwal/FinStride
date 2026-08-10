# PROJECT_CONTEXT.md

> Regenerated 2026-08-10. Consolidated architecture reference comparing **FinStride** (`C:\Tools\YashUGShejwal\FinStride`, active project) against **FinFusion** (`C:\Tools\YashUGShejwal\FinFusion`, legacy reference implementation being mined for reusable logic).

---

## 1. Tech Stack & Architecture

| Layer | FinStride | FinFusion |
|---|---|---|
| Framework | TanStack Start (`@tanstack/react-start` 1.167) + TanStack Router 1.168, file-based routing | Next.js 13.5 (Pages Router for API, App Router for the single UI page) |
| React | React 19.2 | React 18.2 |
| Build tool | Vite 7 + `@lovable.dev/vite-tanstack-config` wrapper + `@tailwindcss/vite` | Next.js built-in webpack/SWC |
| Hosting target | Cloudflare Workers (`@cloudflare/vite-plugin`, `wrangler.jsonc`, `compatibility_flags: nodejs_compat`) | Node.js server (`next start`) — no cloud target configured |
| Styling | Tailwind CSS v4 (`tw-animate-css`), custom glass/gradient utility classes in `styles.css`, hardcoded dark mode (`<html class="dark">`) | Tailwind CSS 3.3 (`tailwindcss-animate`), custom `.glass-card`/`.hero-gradient` utilities in `globals.css`, light theme, `next-themes` installed but **unused** (no toggle wired up) |
| UI kit | shadcn/ui on Radix primitives (~40 components in `src/components/ui`) | Same shadcn/ui + Radix lineage (~40 components in `components/ui`), slightly older Radix versions |
| Forms | Plain controlled `useState` (no react-hook-form usage found in routes) though `react-hook-form` + `@hookform/resolvers` + `zod` are dependencies | Plain controlled `useState` everywhere; `react-hook-form`, `@hookform/resolvers`, `zod` are declared dependencies but **zero usage** — dead weight |
| Charts | `recharts` 2.15 (installed; not yet used in any route reviewed) | `recharts` 2.15, actively used for allocation pie + value-trend line charts in `AnalyticsDashboard.tsx` |
| Data fetching / cache | `@tanstack/react-query` 5.83 wired into the router context (`QueryClient` created in `router.tsx`) but **not yet used** by any route for actual queries | None — raw `fetch()` calls with manual `useState`/`useEffect`, no cache layer |
| State management | React Context (`StoreProvider` in `src/lib/store.tsx`) backed by `localStorage`, single global provider wrapping the whole authenticated app | No global store at all — all state lives in one root page component (`app/page.tsx`) and is prop-drilled to children |
| Persistence | Browser `localStorage` only (multiple keys, see §2) | Server-side flat JSON files (`data/transactions.json`, `data/portfolios.json`) written via Node `fs`, read/written through Next.js API routes |
| API design | **None** — no custom REST/RPC endpoints; `src/server.ts`/`src/start.ts` exist only to wrap TanStack Start's SSR pipeline with branded-error handling | Classic Next.js Pages-Router API handlers (`pages/api/transactions.ts`, `pages/api/portfolios.ts`) — REST-ish `GET`/`POST`/`DELETE` per resource, JSON in/out, manual validation, no auth/pagination/rate-limiting |
| Auth | Mock, localStorage-backed (`src/lib/auth.tsx`) — explicitly designed as a drop-in placeholder for Supabase Auth | **None** — no auth at all, no user concept anywhere |
| Notifications/toasts | `sonner` 2.0 | `sonner` 1.5 (plus unused shadcn `use-toast.ts`/`toaster.tsx` scaffolding that isn't mounted) |
| PWA | `manifest.json` + custom install-prompt banner (`src/lib/pwa.tsx`); **no service worker**, so no offline caching despite "standalone" manifest | None |
| Validation | `zod` present as a dependency, not used | `zod` present as a dependency, not used |
| Lint/format | ESLint flat config + `typescript-eslint` + Prettier-as-ESLint-rule, `noUnusedLocals`/`noUnusedParameters` relaxed | `next lint` (ESLint 8, `eslint-config-next`), no Prettier integration |
| Scaffolding origin | Lovable.dev TanStack Start template (`.lovable/project.json`) | Bolt.new `nextjs-shadcn` template (`.bolt/config.json`) |
| Package manager | bun (`bun.lock`, `bunfig.toml`) — a stray `package-lock.json` also exists in the repo | npm (`package-lock.json`) |
| Tests | None in either repo — no test framework dependency, no test files. |

**Architectural pattern summary:** FinStride is a **client-heavy SPA with no backend** — TanStack Start's server layer is used exclusively for SSR/error-hardening, not for data APIs; all financial data lives in browser `localStorage`, decoupled from the mock auth user. FinFusion is a **traditional two-tier web app** — a Next.js API layer backed by JSON-file storage on the server, consumed by a single client page with manual `fetch`-based data loading. Both apps are **single-user by construction**, but for different reasons: FinStride because localStorage isn't namespaced by user id; FinFusion because it has no user/auth concept whatsoever and one shared JSON file serves all requests.

### API design patterns

- **FinFusion**: REST-ish, one file per resource, `switch (req.method)`. Inline validation with hand-rolled `typeof`/`parseFloat` checks and 400s — despite `zod` being a dependency, it is **not used** for request validation. IDs are `Date.now().toString()` (collision risk on rapid/concurrent calls). No auth/authorization on any route — anyone with network access to the server can read/write/delete all data. No PATCH/PUT — records can only be appended or deleted, never edited in place. `pages/api/portfolios.ts` has a dedicated `toSnapshotDate()`/`todayLocalISO()` pair that resolves "today" to a real timestamp but backfilled historical dates to `T12:00:00.000Z` (noon UTC), specifically to support backdating snapshots.
- **FinStride**: There is **no custom API surface at all**. Every "write" is a synchronous `localStorage.setItem` inside a `useEffect` triggered by React state changes in `StoreProvider`. `db.ts`'s doc comments describe the intended future shape (Supabase Postgres, snake_case, `user_id` foreign keys) but nothing calls it.

---

## 2. Data Models & Schemas

### 2.1 FinFusion — `types/index.ts` (exact, in use today)

```typescript
export interface Transaction {
  id: string;
  date: string; // ISO string
  app: string;
  type: 'Deposit' | 'Withdrawal';
  amount: number;
  note?: string;
}

export interface PortfolioSnapshot {
  id: string;
  app: string;
  date: string;
  currentValue: number;
}

export interface AppSummary {
  app: string;
  totalDeposits: number;
  totalWithdrawals: number;
  netInvestment: number;
  currentValue: number;
  absoluteReturn: number;
  percentageReturn: number;
}

export interface FilterOptions {
  apps?: string[];
  dateFrom?: string;
  dateTo?: string;
}
```

- `AppSummary` is **always derived**, never persisted — computed on every render by `calculateAppSummary()`.
- `app` is a free-form string; the UI constrains input to `INVESTMENT_APPS` (`lib/calculations.ts`) — `['Groww','Groww SGB','Groww MF','Kotak Neo','Dhan','INDmoney US','INDMoney Indian','Zerodha Kite','Other']` — but the API layer does **not** enforce this enum server-side; any string is accepted.
- `PortfolioSnapshot` is **append-only** — every POST adds a new row; "current value per app" is always derived client/server-side by picking the max-date row per `app` (`getLatestPortfolios()` in both `lib/storage.ts` and `PortfolioHistory.tsx`).

### 2.2 FinStride — two-tier model: future-DB shape vs. local runtime shape

FinStride explicitly separates a **planned Supabase Postgres schema** (`src/lib/db.ts`, snake_case, one interface per table) from the **local camelCase runtime shape** actually used by the app (`src/lib/store.tsx`). Every local type's doc comment states its exact DB column mapping, and several local fields are explicitly `local-only` (no DB column exists yet).

**`src/lib/db.ts` (planning-only — no client, no queries reference these):**

```typescript
// profiles (id uuid pk, updated_at timestamptz, full_name text)
export interface DbProfile {
  id: string;
  updated_at: string | null;
  full_name: string | null;
}

// cashflow_ledger (id uuid pk, user_id uuid fk→profiles, date date,
//   type text check(income|expense), category text, account text, amount numeric, notes text)
export interface DbCashflowRow {
  id: string;
  user_id: string;
  date: string;
  type: "income" | "expense";
  category: string;
  account: string;
  amount: number;
  notes: string | null;
}

// swing_trades (id uuid pk, user_id uuid fk→profiles, ticker text,
//   entry_date date, exit_date date nullable, qty integer, entry_price numeric,
//   stop_loss numeric, target_price numeric, status text check(open|closed), source text)
export interface DbSwingTradeRow {
  id: string;
  user_id: string;
  ticker: string;
  entry_date: string;
  exit_date: string | null;
  qty: number;
  entry_price: number;
  stop_loss: number;
  target_price: number;
  status: "open" | "closed";
  source: string;
}

// portfolio_snapshots (id uuid pk, user_id uuid fk→profiles,
//   snapshot_date date, broker_partition text, current_value numeric)
// One row per (snapshot_date, broker_partition) pair — normalized.
export interface DbPortfolioSnapshotRow {
  id: string;
  user_id: string;
  snapshot_date: string;
  broker_partition: string;
  current_value: number;
}
```

**Note:** there is **no `Db*` interface for the Grind Deck (metrics/hustle) or the Pending-obligations checklist** anywhere — if the Supabase migration in `db.ts` were executed as-is, those two features would have nowhere to persist without new tables being designed.

**`src/lib/store.tsx` (local runtime shapes, actually used by every route):**

```typescript
export type PaymentMode = "Bank Account" | "Cash" | "Credit Card";

export type BrokerPartition =
  | "Zerodha Vault" | "Dhan Swing" | "INDmoney US"
  | "CoinDCX Crypto" | "Groww MF" | "Cash";

export type TxType = "income" | "expense";
export type TxCategory = "Salary" | "Fixed Runrate" | "Scooter EMI" | "Freelance" | "Other";

// Mirrors cashflow_ledger; `tags` is local-UI-only, no DB column.
export type Transaction = {
  id: string;
  date: string;           // DB: date
  type: TxType;           // DB: type
  category: TxCategory;   // DB: category
  account: PaymentMode;   // DB: account
  amount: number;         // DB: amount
  tags: string[];         // local UI only — NOT in DB schema
  notes?: string;         // DB: notes
};

export type TradeStatus = "open" | "closed";
export type CloseReason = "target" | "stoploss" | "other";

// Mirrors swing_trades; direction/partition/closeReason/closeNotes are local-only extensions.
export type Trade = {
  id: string;
  ticker: string;             // DB: ticker
  entryDate: string;          // DB: entry_date
  direction: "LONG";          // local only — no DB column (implicitly long-only)
  qty: number;                // DB: qty
  entryPrice: number;         // DB: entry_price
  targetPrice: number;        // DB: target_price
  stopLoss: number;           // DB: stop_loss
  source: "TheDoji" | "Self"; // DB: source
  partition: BrokerPartition; // local only — broker account used, no DB column yet
  notes?: string;              // local only — entry rationale
  status: TradeStatus;         // DB: status
  closeReason?: CloseReason;   // local only
  closeNotes?: string;         // local only
  exitDate?: string;           // DB: exit_date
};

export type PortfolioPartitionKey = "Zerodha Vault" | "Dhan Swing" | "INDmoney US" | "Cash";
// ^ note: a strict SUBSET of BrokerPartition — CoinDCX Crypto and Groww MF are valid
//   trade/cashflow partitions but are NOT tracked in portfolio snapshots.

// One row per (snapshotDate, brokerPartition) — mirrors portfolio_snapshots exactly.
export type PortfolioSnapshot = {
  id: string;
  snapshotDate: string;                    // DB: snapshot_date
  brokerPartition: PortfolioPartitionKey;  // DB: broker_partition
  currentValue: number;                    // DB: current_value
  notes?: string;                          // local-only; not in DB schema
};

// ─── Grind Deck (no DB counterpart at all) ────────────────────────────────
export type GrindMetricKey = "systemDesign" | "leetcode" | "linkedinOutreach";
export type GrindLogEntry = { id: string; loggedAt: string; label: string; meta?: string };
export type GrindMetrics = Record<GrindMetricKey, GrindLogEntry[]>;

export type HustleCategory = "Freelance" | "Consulting" | "Media Production";
export type HustleEntry = { id: string; date: string; category: HustleCategory; description: string; amount: number };

export type GrindState = { metrics: GrindMetrics; hustle: HustleEntry[] };

// ─── Pending obligations (localStorage only, keyed by "YYYY-MM") ─────────
export type ObligationKey = "fixedRunrate" | "scooterEmi" | "growwMfSip" | "ccSettled";
export type MonthlyPending = Partial<Record<ObligationKey, boolean>>;
```

**No `AppSummary`/analytics type exists in FinStride.** Every derived figure (dashboard KPIs, risk cap, runway, credit-card dues) is computed **inline inside route components** from `BLUEPRINT` constants + raw `transactions`/`trades` arrays — there is no shared calculation module equivalent to FinFusion's `lib/calculations.ts`.

**Hardcoded business constants** (`store.tsx`, exported as `BLUEPRINT`):

```typescript
export const BLUEPRINT = {
  salaryBaseline: 76000,
  fixedRunrate: 39000,
  scooterEmi: 9000,
  growwMfSip: 5000,
  accountBalance: 300000,
  riskCapPct: 0.03,
};
```

### 2.3 Schema/type comparison at a glance

| Concept | FinFusion | FinStride |
|---|---|---|
| Money movement | `Transaction` (Deposit/Withdrawal, free-form `app`) | `Transaction` (income/expense, fixed `TxCategory` enum, fixed `PaymentMode` enum, plus free-text `tags[]`) |
| Point-in-time value | `PortfolioSnapshot` (per `app`, unrestricted string) | `PortfolioSnapshot` (per `brokerPartition`, closed 4-value union) |
| Trading | *(none — FinFusion has no trade concept)* | `Trade` (LONG-only swing trades, target/stop, F&O-blocked, risk-capped) |
| Derived analytics | `AppSummary` (persisted-shape, computed) | *(none — inline math per route)* |
| Multi-tenancy | No `user_id` anywhere | `user_id` present in every **planned** DB row shape, absent from every **actual** local type |
| Career/side-income tracking | *(none)* | `GrindState` (interview-prep reps + side-hustle income) — no DB plan yet |

---

## 3. Current FinStride Implementation

### Routes (`src/routes/`, TanStack Router file-based)

- `/` → `index.tsx` — immediate `redirect({ to: "/dashboard" })`, no content of its own.
- `/login`, `/signup` — mock-auth forms; on success, navigate to `/dashboard`.
- `/_authenticated` (`_authenticated.tsx`) — pathless layout route; `beforeLoad` redirects to `/login` if `getStoredAuthUser()` is null; renders `<AppShell/>`.
  - `/dashboard` — KPI cards (salary baseline, "runway" = `salaryBaseline − (fixedRunrate + scooterEmi)`, active commitments), 4 mini-stats (logged income/expense/net/active-trade-count), latest 5 transactions, 2 quick-action links.
  - `/cashflow` — add-transaction form (date/type/category/account/amount/tags/notes) + searchable ledger (desktop table + mobile card list), instant delete (no undo).
  - `/swing` — **Capital Snapshot panel** (collapsible; per-partition manual current-value entry across the 4 `PORTFOLIO_PARTITIONS`, feeds `dhanSwingCapital`), **entry form** with a hardcoded F&O-blocking regex (`FNO_REGEX` rejects CE/PE/NIFTY/SENSEX/BANKNIFTY/FINNIFTY/expiry-date patterns on the ticker field), a live risk meter (`exposure = qty × entryPrice` vs. `cap = dhanSwingCapital × 3%`) that **disables submit** when exceeded, open/closed trade lists, an inline close-out flow (must pick target/stoploss/other + optional notes) that computes and displays R:R (`(target−entry)/(entry−stop)`).
  - `/grind` — two sub-tabs: "30 LPA Interview Prep" (3 fixed counters/logs: systemDesign, leetcode, linkedinOutreach) and "Side Hustle Engine" (income ledger across 3 fixed categories with per-category totals).
  - `/pending` — credit-card dues **auto-summed** from the cashflow ledger (`expense` rows where `account === "Credit Card"`); a "mark settled" checkbox is a **cosmetic per-month flag only** — it does not zero or archive the underlying ledger rows, so the displayed total never actually decreases unless the ledger entries themselves are deleted. Also: 3 fixed monthly obligations with manual paid/unpaid toggles, keyed per `"YYYY-MM"`.
  - `/profile` — user info, aggregate stats, list of the 6 `INVESTMENT_APPS` partitions with their scopes, a read-only Blueprint summary, sign-out.

### Shared UI/utilities

- `src/components/AppShell.tsx` — desktop sidebar (6 links) + mobile bottom nav (4-col grid, same 6 items truncated visually to fit) + mobile top header; active-route highlighting via `path.startsWith(n.to)`.
- `src/lib/format.ts` — `inr()` / `inrCompact()` (Intl `en-IN` currency, 0 or compact fraction digits) / `fmtDate()` (`en-IN`, `dd MMM yyyy`).
- `src/lib/utils.ts` — `cn()` (clsx + tailwind-merge), standard shadcn helper.
- `src/lib/quotes.ts` + `src/hooks/useDailyQuote.ts` + `src/components/DailyQuoteFooter.tsx` — a fixed pool of motivational quotes tagged `PERSONAL`/`GENERAL`; the **owner's email is hardcoded** (`OWNER_EMAIL = "test78@gmail.com"`) to gate which pool a signed-in user sees; one quote is deterministically cached per calendar day via `localStorage`.
- `src/lib/pwa.tsx` — install-prompt banner with iOS (manual "Add to Home Screen" instructions) vs. Android (native `beforeinstallprompt`) branches; dismissal persisted to `localStorage`.
- `public/manifest.json` — PWA manifest (standalone display, 4 icon sizes, 3 shortcuts to dashboard/swing/cashflow).

### State management specifics

- `AuthProvider` (`src/lib/auth.tsx`) and `StoreProvider` (`src/lib/store.tsx`) are the **only** state sources; both hydrate from `localStorage` in a mount-time `useEffect` and persist back on every change via dedicated `useEffect`s per key.
- `StoreProvider` includes **migration normalizers** for legacy on-disk shapes: `normalizeTransaction` (accepts old `paymentMode`/`partition` fields, coerces to current `account`), `normalizeTrade` (accepts old `quantity`, `closedAt`), `normalizeSnapshot` (expands a legacy grouped `{ values: {...} }` shape into one row per partition), `normalizePartition`/`normalizePaymentMode` (fall back to a default on unrecognized legacy string values, e.g. old underscore-separated partition names like `Zerodha_Vault`).
- `latestSnapshotValues` and `dhanSwingCapital` are computed on every render from `portfolioSnapshots` (reduce to max-date row per partition; if no Dhan Swing snapshot exists yet, fall back to `BLUEPRINT.accountBalance`).
- `@tanstack/react-query`'s `QueryClient` is provided app-wide in `__root.tsx` but genuinely unused — a clear signal of planned-but-not-yet-wired server data fetching.

---

## 4. FinFusion Legacy Logic Worth Porting

1. **Per-app / per-partition summary math** (`lib/calculations.ts::calculateAppSummary`, `calculateOverallSummary`) — the exact `netInvestment = totalDeposits − totalWithdrawals`, `absoluteReturn = currentValue − netInvestment`, `percentageReturn = netInvestment > 0 ? absoluteReturn/netInvestment × 100 : 0` formulas. FinStride has **no equivalent computed-summary layer** for its `portfolioSnapshots` domain — this is directly reusable to build a "Portfolio Overview" analogous to FinFusion's Overview tab, keyed by `BrokerPartition`/`PortfolioPartitionKey` instead of `app`.
2. **Multi-series forward-fill timeline builder** (`AnalyticsDashboard.tsx`) — merges all unique snapshot dates across apps, and for each app/date carries forward the most recent prior value when that app has no exact-date row (`previousData = appData.filter(p => p.date < date).sort(...)[0]`). This is exactly what's missing for a FinStride "Portfolio Trends" line chart across the 4 `PORTFOLIO_PARTITIONS` — currently `/swing`'s Capital Snapshot panel only ever shows the single latest value per partition, with no historical/trend visualization at all.
3. **Portfolio allocation pie-chart derivation** — `percentage = currentValue / totalCurrentValue × 100` per app, filtered to `value > 0`. Directly portable to visualize FinStride's partition allocation.
4. **Historical-backfill-safe date resolution** (`pages/api/portfolios.ts::toSnapshotDate`/`todayLocalISO`) — "today" gets the real current timestamp; any other date (past *or future*) is pinned to `T12:00:00.000Z` so display/sorting is stable regardless of the entering user's timezone. FinStride's `addPortfolioSnapshots` **always** stamps `new Date().toISOString()` — there is currently **no way to backfill a historical snapshot** in FinStride at all. This is a direct, high-value port.
5. **Optimistic delete-with-undo** (`app/page.tsx::handleDeleteTransaction`/`handleDeletePortfolio`) — remove from UI state immediately, defer the actual delete for 5 seconds via `setTimeout`, surface a toast with an "Undo" action that clears the timeout and restores the item. FinStride's `deleteTransaction`/`deleteTrade`/`deleteHustleEntry`/`deletePortfolioSnapshot` are all **instant and irreversible** — a straightforward and high-leverage UX port.
6. **Multi-select filter bar with removable badge chips + date range** (`FilterBar.tsx`) — select-all, per-item toggle, and a from-to date range, all reflected as dismissible `Badge` chips. FinStride's only filtering anywhere is a single free-text search box on `/cashflow`; there is no date-range or multi-partition filter on any page.
7. **"Time ago" humanizer** (`PortfolioHistory.tsx::getTimeAgo` — today / N days / N weeks / N months / N years ago) — not present in FinStride's `fmtDate`.
8. **Expandable per-app snapshot history** (`PortfolioHistory.tsx`) — clicking an app's current-value row expands to show every prior snapshot for that app inline. FinStride's snapshot panel exposes only the *latest* value per partition with no drill-down into history, even though the full history already exists in `portfolioSnapshots`.
9. **Append-only-history + derive-latest pattern** (`storage.ts::getLatestPortfolios`, mirrored independently in FinStride's `latestSnapshotValues`) — validates that FinStride's own approach already converged on the same design; worth noting as confirmation rather than a new port.

---

## 5. Architectural Gaps (scaling beyond personal/single-user use)

### Single-user assumptions
- **FinFusion**: zero auth, zero `user_id` anywhere — `data/transactions.json`/`data/portfolios.json` are global singleton files. Two people (or two browser tabs) hitting the same deployment would read/write/overwrite each other's data with no isolation. Not fixable without a full data-layer + auth rewrite.
- **FinStride**: the *planned* DB schema (`db.ts`) is multi-tenant-shaped (`user_id` FK on every table), but the **live implementation is 100% single-browser `localStorage`** — nothing is actually scoped by user. Auth itself is mock: signing in with any email/password ≥6 chars issues a **fresh random `crypto.randomUUID()`** every session, so "your account" isn't durable or unique across sign-ins/devices — it's session theater, not identity.
- **Hardcoded personal constants baked into source**: `BLUEPRINT` (salary ₹76,000, fixed runrate ₹39,000, scooter EMI ₹9,000, 3% risk cap, etc. — `store.tsx`) and `OWNER_EMAIL = "test78@gmail.com"` (`useDailyQuote.ts`) encode one specific person's finances and identity directly in shipped code. This is the single largest blocker to any multi-user story: even with a real backend and real auth wired in, every user would share identical blueprint numbers unless/until `BLUEPRINT` becomes a per-user settings row.

### Database / indexing limits
- **FinFusion**: no database — plain JSON arrays rewritten **in full** on every write (`fs.writeFile` of the entire file). No indexing, O(n) linear filtering on every request, and no locking/transactions, so concurrent writers race (a delete + an add landing in the same window can silently drop one). This will not hold up past a few thousand rows or any concurrent access.
- **FinStride**: no database connected — `db.ts` is speculative typing with no client. `localStorage` has a practical ~5–10MB per-origin ceiling, is synchronous (blocks the main thread on large reads/writes), is not shared across devices/browsers, and disappears on cache-clear with no backup. The planning doc in `db.ts` also doesn't define any index strategy (e.g., a composite index on `(user_id, snapshot_date, broker_partition)` or `(user_id, date)`) for when real Postgres rows exist.

### API constraints
- **FinFusion**: IDs are `Date.now().toString()` — collides under rapid or concurrent POSTs. No auth/authorization on any endpoint — any network client can read/write/delete everything. No PATCH/PUT — editing a record means delete + recreate. No pagination — `GET` always returns the entire history array.
- **FinStride**: there is **no API at all** to constrain — every mutation is a direct `localStorage.setItem` from within `StoreProvider`. Consequences: no server-side validation on write (the `normalize*` functions in `store.tsx` only sanitize data on *read*, e.g. when hydrating from `localStorage` — a bad `addTransaction` call would be stored unchecked); no cross-device sync; and the existing PWA scaffolding (`manifest.json`, install banner) provides an installable icon but **no service worker or IndexedDB**, so "offline support" today is purely cosmetic, not functional.

### Missing features relative to a scaling product (both apps)
- No pagination anywhere — every list renders its full lifetime history.
- No edit-in-place for transactions, trades, or snapshots in either app — only add + delete.
- No soft-delete or audit trail. FinFusion delays the actual delete 5s (recoverable via Undo toast); FinStride deletes are immediate and final with no recovery path after the toast disappears.
- No CSV/broker-statement import — both tools are 100% manual data entry.
- No automated price/NAV/quote fetching — every "current value" in both apps is a manually typed snapshot.
- FinStride's **Grind Deck** and **Pending-obligations** features have no corresponding table in the existing Supabase migration plan (`db.ts`) at all — porting to a real backend as currently scoped would leave those two modules with nowhere to persist without additional schema design.
