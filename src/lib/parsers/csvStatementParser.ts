/**
 * Client-side CSV statement parser for Indian bank / credit-card exports.
 *
 * Everything here runs in the browser on an in-memory string — no row ever
 * leaves the device (see the privacy badge in CsvImportDrawer). The parser is
 * deliberately forgiving about the messy reality of Indian bank CSVs:
 *
 *   - Account-metadata preambles before the real table (HDFC, ICICI, SBI all
 *     ship several junk lines above the header row) — scanned past, not fatal.
 *   - Wildly inconsistent header names — matched fuzzily against synonym sets.
 *   - Split Debit/Credit columns OR a single signed Amount column (with or
 *     without a Dr/Cr type column alongside).
 *   - Indian date formats: DD/MM/YYYY, DD-MM-YYYY, DD-MMM-YYYY, DD/MM/YY,
 *     YYYY-MM-DD, "DD MMM YYYY".
 *   - Amount noise: thousands commas, ₹/INR prefixes, "Cr"/"Dr" suffixes,
 *     parenthesised negatives.
 *
 * When auto-detection can't find the required columns, the result degrades to
 * `needs-mapping` with the raw grid so the UI can ask the user to map columns
 * by hand (CsvImportDrawer step B) and re-run extraction via applyMapping().
 */

import Papa from "papaparse";
import type { TxType } from "@/lib/store";

// ─── Result shapes ───────────────────────────────────────────────────────────
export type StatementDirection = "debit" | "credit";

export type ParsedStatementRow = {
  /** Position in the source grid — stable identity for the staging UI. */
  sourceIndex: number;
  /** UTC-midnight ISO instant, same format addTransaction stores (new Date("YYYY-MM-DD").toISOString()). */
  dateISO: string;
  rawDate: string;
  narration: string;
  /** Collapsed/title-cased narration for display; raw stays in the tooltip. */
  cleanedNarration: string;
  /** Always a positive magnitude — direction carries the sign. */
  amount: number;
  direction: StatementDirection;
  refNo?: string;
  suggestedCategory: string;
  suggestedType: TxType;
};

export type ColumnMapping = {
  date: number;
  narration: number;
  /** Split-column shape. Either both of these… */
  debit?: number;
  credit?: number;
  /** …or a single signed amount column (optionally disambiguated by a Dr/Cr column). */
  amount?: number;
  drcr?: number;
  ref?: number;
};

export type ParseSuccess = {
  status: "ok";
  rows: ParsedStatementRow[];
  mapping: ColumnMapping;
  headers: string[];
  headerRowIndex: number;
  /** Data lines that existed below the header but could not be parsed (footers, totals, blanks). */
  skippedRows: number;
  /** Raw grid, kept so the review UI can offer "re-map columns" even after a successful auto-detect. */
  grid: string[][];
};

export type ParseNeedsMapping = {
  status: "needs-mapping";
  /** Best-guess header row — what the manual mapper's dropdowns list. */
  headers: string[];
  headerRowIndex: number;
  /** Full raw grid so applyMapping() can re-extract once the user maps columns. */
  grid: string[][];
  reason: string;
};

export type ParseFailure = { status: "error"; reason: string };

export type ParseResult = ParseSuccess | ParseNeedsMapping | ParseFailure;

// ─── Fuzzy header matching ───────────────────────────────────────────────────
/** Lowercase and strip everything non-alphanumeric: "Chq/Ref No." -> "chqrefno". */
function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Synonym sets are matched on the NORMALIZED form. Order within a set is
// priority order — when a sheet carries both "Txn Date" and "Value Date"
// (HDFC does), the transaction date wins.
const DATE_HEADERS = [
  "txndate", "transactiondate", "trandate", "date", "postingdate", "valuedate", "valuedt",
];
const NARRATION_HEADERS = [
  "narration", "description", "particulars", "transactionremarks", "details", "remarks",
  "transactiondetails", "merchantname",
];
const DEBIT_HEADERS = [
  "debit", "withdrawal", "debitamount", "withdrawalamt", "withdrawalamount",
  "debitamt", "dr", "withdrawaldr", "debitdr",
];
const CREDIT_HEADERS = [
  "credit", "deposit", "creditamount", "depositamt", "depositamount",
  "creditamt", "cr", "depositcr", "creditcr",
];
const AMOUNT_HEADERS = ["amount", "amountinr", "transactionamount", "amt", "txnamount"];
const DRCR_HEADERS = ["drcr", "type", "crdr", "debitcredit", "transactiontype", "txntype"];
const REF_HEADERS = [
  "chqrefno", "referencenumber", "utr", "txnid", "chequerefno", "refno",
  "chqno", "referenceno", "transactionid", "utrnumber",
];

/**
 * Headers that LOOK like value columns via containment but never hold the
 * transaction value — "Credit Limit", "Debit Card No", "Available Balance".
 * Binding one of these as a debit/credit/amount column silently corrupts
 * every row, so the containment pass refuses them outright.
 */
const VALUE_HEADER_TRAPS = /(limit|balance|cardno|card|number)/;

/** Exact match against the synonym set, in set-priority order. */
function findColumnExact(normalized: string[], synonyms: string[]): number | undefined {
  for (const syn of synonyms) {
    const exact = normalized.findIndex((h) => h === syn);
    if (exact >= 0) return exact;
  }
  return undefined;
}

/**
 * Exact match first, then containment ("Withdrawal Amt (INR)" ->
 * "withdrawalamtinr"). 2-char forms ("dr"/"cr") never containment-match —
 * they'd false-hit inside unrelated words. `blockValueTraps` is set for the
 * three VALUE columns (debit/credit/amount) — see VALUE_HEADER_TRAPS.
 */
function findColumnLoose(
  normalized: string[],
  synonyms: string[],
  blockValueTraps = false,
): number | undefined {
  const exact = findColumnExact(normalized, synonyms);
  if (exact !== undefined) return exact;
  for (const syn of synonyms) {
    if (syn.length <= 2) continue;
    const contains = normalized.findIndex(
      (h) => h.includes(syn) && !(blockValueTraps && VALUE_HEADER_TRAPS.test(h)),
    );
    if (contains >= 0) return contains;
  }
  return undefined;
}

/**
 * Try to interpret one grid row as the table header.
 *
 * Precedence rules, each earned by a real statement shape:
 *   1. A combined "Debit/Credit" header matches BOTH sides at the same index —
 *      that's a Dr/Cr INDICATOR column, not a split pair; pair it with the
 *      Amount column instead (or reject the row).
 *   2. EXACT split Debit/Credit headers win.
 *   3. An EXACT "Amount" header beats containment-only debit/credit hits, so
 *      "Credit Limit"-style columns can't hijack the split path away from a
 *      real Amount column.
 *   4. Containment split, then containment amount, as last resorts.
 */
function mappingFromHeaderRow(row: string[]): ColumnMapping | null {
  const normalized = row.map(normalizeHeader);
  const date = findColumnLoose(normalized, DATE_HEADERS);
  const narration = findColumnLoose(normalized, NARRATION_HEADERS);
  if (date === undefined || narration === undefined) return null;
  const ref = findColumnLoose(normalized, REF_HEADERS);

  const debit = findColumnLoose(normalized, DEBIT_HEADERS, true);
  const credit = findColumnLoose(normalized, CREDIT_HEADERS, true);
  const amount = findColumnLoose(normalized, AMOUNT_HEADERS, true);
  const drcr = findColumnLoose(normalized, DRCR_HEADERS);

  if (debit !== undefined && debit === credit) {
    if (amount !== undefined && amount !== debit) {
      return { date, narration, amount, drcr: debit, ref };
    }
    return null;
  }

  const debitExact = findColumnExact(normalized, DEBIT_HEADERS);
  const creditExact = findColumnExact(normalized, CREDIT_HEADERS);
  const amountExact = findColumnExact(normalized, AMOUNT_HEADERS);

  if (debitExact !== undefined || creditExact !== undefined) {
    return { date, narration, debit: debitExact ?? debit, credit: creditExact ?? credit, ref };
  }
  if (amountExact !== undefined) {
    return { date, narration, amount: amountExact, drcr, ref };
  }
  if (debit !== undefined || credit !== undefined) {
    return { date, narration, debit, credit, ref };
  }
  if (amount !== undefined) {
    return { date, narration, amount, drcr, ref };
  }
  return null;
}

// ─── Date normalizer ─────────────────────────────────────────────────────────
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** 2-digit years pivot at 70: 26 -> 2026, 99 -> 1999. */
function expandYear(y: number): number {
  if (y >= 100) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

function toISO(y: number, m: number, d: number): string | null {
  // Sane-year clamp: a typo'd "21/08/202" would otherwise import dated 202 AD.
  if (y < 1971 || y > 2100) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  // Round-trip check rejects impossible dates like 31/02/2026.
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return `${iso}T00:00:00.000Z`;
}

/**
 * Normalize an Indian-bank date string to the UTC-midnight ISO instant the
 * app's ledger stores. Returns null when the cell is not a date — which is
 * also how data-row extraction detects footer/total/blank lines.
 */
export function normalizeStatementDate(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;

  // YYYY-MM-DD / YYYY/MM/DD (optionally with a trailing time we ignore)
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (m) return toISO(Number(m[1]), Number(m[2]), Number(m[3]));

  // DD-MMM-YYYY / DD MMM YYYY / DD-MMM-YY ("01-Jan-2026", "1 JAN 26")
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2,4})\b/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!mon) return null;
    return toISO(expandYear(Number(m[3])), mon, Number(m[1]));
  }

  // DD/MM/YYYY / DD-MM-YYYY / DD.MM.YYYY / DD/MM/YY — day-first, the Indian default.
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) return toISO(expandYear(Number(m[3])), Number(m[2]), Number(m[1]));

  return null;
}

// ─── Amount parsing ──────────────────────────────────────────────────────────
/**
 * "1,23,456.78 Cr", "₹2,500", "(500.00)", "-1200" → signed number.
 * Returns null for blank/non-numeric cells (e.g. "-" placeholders).
 */
export function parseStatementAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s || s === "-" || s === "--") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  // No \b before (cr|dr): digit→letter is not a word boundary, so "1,234.00Cr"
  // (no space — some banks emit exactly this) must still match.
  const suffix = s.match(/\s*(cr|dr)\.?$/i)?.[1]?.toLowerCase();
  if (suffix === "dr") sign = -1;
  s = s
    .replace(/\s*(cr|dr)\.?$/i, "")
    .replace(/(inr|rs\.?|₹)/gi, "")
    .trim();
  // Indian digit grouping always puts exactly 3 digits after the LAST comma
  // ("1,23,456.78"). A European decimal comma ("1.234,56" or "1234,56") does
  // not — stripping its commas would silently corrupt the value by 100–1000×,
  // so reject rather than mis-parse.
  const lastComma = s.lastIndexOf(",");
  if (lastComma >= 0 && !/^\d{3}$/.test(s.slice(lastComma + 1).split(".")[0])) return null;
  s = s.replace(/,/g, "").trim();
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : null;
}

// ─── Narration cleanup ───────────────────────────────────────────────────────
/**
 * Display form of a narration: separators collapsed to spaces, whitespace
 * squeezed, then title-cased (all-caps runs included). The RAW string is
 * preserved on the row for tooltips — this is presentation only.
 */
export function cleanNarration(raw: string): string {
  const collapsed = raw
    .replace(/[/\\_]+/g, " ")
    .replace(/-{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) return raw.trim();
  return collapsed
    .split(" ")
    .map((w) => (w.length > 1 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
    .join(" ");
}

// ─── Indian merchant categorizer ─────────────────────────────────────────────
// Keyword → app category. Category strings MUST match the app's built-in
// defaults in src/lib/store.tsx (DEFAULT_INCOME_CATEGORIES /
// DEFAULT_EXPENSE_CATEGORIES) so the review grid's dropdowns pre-select them.
type CategoryRule = { keywords: string[]; category: string };

// NOTE — deliberately ABSENT from Capital Transfer (Out): credit-card bill
// keywords ("CRED", "CC payment", "BillDesk"). Analytics derives netInvestment
// and return % from the Capital Transfer categories (they mean INVESTMENT
// deposits/withdrawals in this app), so auto-tagging monthly card bills as
// capital transfers would silently inflate "invested capital" by lakhs.
// Likewise "payout" is absent from Capital Transfer (In) — a freelancer's
// "RAZORPAY PAYOUT" is income, not an investment withdrawal.
const EXPENSE_RULES: CategoryRule[] = [
  {
    category: "Dining",
    keywords: ["swiggy", "zomato", "starbucks", "mcdonald", "mcdonalds", "dominos", "domino's", "kfc", "dineout", "blinkit cafe", "eatclub", "faasos"],
  },
  {
    category: "Groceries",
    // "metro cash" (METRO Cash & Carry, wholesale groceries) sits here — above
    // Fuel's bare "metro" (rail), which would otherwise claim it.
    keywords: ["blinkit", "zepto", "instamart", "bigbasket", "big basket", "dmart", "d mart", "nature's basket", "natures basket", "jiomart", "grofers", "reliance fresh", "more retail", "metro cash"],
  },
  {
    category: "Fuel",
    keywords: ["uber", "ola", "olacabs", "rapido", "shell", "hpcl", "bpcl", "indianoil", "indian oil", "iocl", "fastag", "metro", "dmrc", "irctc", "redbus", "petrol", "fuel"],
  },
  {
    category: "Subscriptions",
    keywords: ["netflix", "spotify", "apple.com", "apple services", "itunes", "google play", "google one", "youtube", "amazon prime", "primevideo", "hotstar", "chatgpt", "openai", "midjourney", "anthropic", "claude.ai"],
  },
  {
    category: "Capital Transfer (Out)",
    keywords: ["zerodha", "groww", "dhan", "indmoney", "ind money", "upstox", "coindcx", "kite", "angel one", "angelone", "wazirx", "smallcase", "kuvera", "etmoney", "paytm money"],
  },
  {
    category: "Fixed Runrate",
    keywords: ["electricity", "airtel", "jio", "vi", "vodafone", "act fibernet", "actcorp", "tata power", "bescom", "mseb", "adani electricity", "rent", "maintenance", "society", "bwssb", "water bill", "gas bill", "indane", "hp gas", "broadband", "wifi", "dth", "tatasky", "tata play"],
  },
  {
    category: "Loan/EMI",
    keywords: ["emi", "loan", "bajaj fin", "hdfc ltd", "lic hfl", "home credit"],
  },
];

const INCOME_RULES: CategoryRule[] = [
  {
    category: "Salary",
    keywords: ["salary", "payroll", "sal credit", "wages", "stipend"],
  },
  {
    category: "Capital Transfer (In)",
    keywords: ["zerodha", "groww", "dhan", "indmoney", "ind money", "upstox", "coindcx", "kite", "angel one", "angelone", "wazirx", "smallcase", "kuvera", "etmoney", "paytm money", "redemption"],
  },
  {
    category: "Freelance",
    keywords: ["freelance", "upwork", "fiverr", "consulting", "invoice"],
  },
  // Dividends / interest / generic inward transfers have no dedicated built-in
  // income category — they fall through to "Other" via the default below.
];

/**
 * TOKEN-BOUNDED keyword regex: the keyword must start and end at a
 * non-alphanumeric boundary. Plain substring matching produced systematic
 * false positives on real narrations — "emi"⊂PREMIUM/CHEMIST, "vi"⊂NAVI
 * MUMBAI/RAVI, "rent"⊂CURRENT, "ola"⊂CHOLAMANDALAM — every one of which
 * would land a wrong pre-applied tag on a default-selected row.
 */
function keywordRegex(keyword: string): RegExp {
  const esc = keyword.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`);
}

type CompiledRule = { category: string; patterns: RegExp[] };
const compileRules = (rules: CategoryRule[]): CompiledRule[] =>
  rules.map((r) => ({ category: r.category, patterns: r.keywords.map(keywordRegex) }));

const COMPILED_EXPENSE_RULES = compileRules(EXPENSE_RULES);
const COMPILED_INCOME_RULES = compileRules(INCOME_RULES);

/**
 * Suggest an app category (+ tx type) for a narration, given the money's
 * direction. Direction decides income vs expense; the keyword tables refine
 * the category within that side. Anything unmatched lands on "Other" so the
 * suggestion is always a real, selectable category.
 */
export function categorizeNarration(
  narration: string,
  direction: StatementDirection,
): { category: string; type: TxType } {
  const hay = narration.toLowerCase();
  const rules = direction === "debit" ? COMPILED_EXPENSE_RULES : COMPILED_INCOME_RULES;
  for (const rule of rules) {
    if (rule.patterns.some((p) => p.test(hay))) {
      return { category: rule.category, type: direction === "debit" ? "expense" : "income" };
    }
  }
  return { category: "Other", type: direction === "debit" ? "expense" : "income" };
}

// ─── Row extraction ──────────────────────────────────────────────────────────
type DrCrHint = StatementDirection | null;

/**
 * Interpret a Dr/Cr-style type cell: "DR", "Dr.", "(Cr)", "Debit",
 * "withdrawal"… Punctuation/whitespace is stripped first — banks routinely
 * abbreviate with a trailing period, and missing that would silently invert
 * the direction of every row (the sign fallback would kick in).
 */
function parseDrCrCell(raw: string | undefined): DrCrHint {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/[().\s]+/g, "");
  if (/^(dr|d|debit|withdrawal|w)$/.test(s)) return "debit";
  if (/^(cr|c|credit|deposit)$/.test(s)) return "credit";
  return null;
}

/**
 * Extract statement rows from the grid using a known column mapping. Rows
 * whose date or amount cells don't parse (footers, running-balance summaries,
 * blank spacer lines) are skipped and counted, never fatal.
 */
export function applyMapping(
  grid: string[][],
  headerRowIndex: number,
  mapping: ColumnMapping,
): { rows: ParsedStatementRow[]; skippedRows: number } {
  const rows: ParsedStatementRow[] = [];
  let skippedRows = 0;

  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!cells || cells.every((c) => !c?.trim())) continue; // pure blank line — not worth counting

    const dateISO = normalizeStatementDate(cells[mapping.date] ?? "");
    if (!dateISO) {
      skippedRows++;
      continue;
    }

    let amount: number | null = null;
    let direction: StatementDirection | null = null;

    if (mapping.amount !== undefined) {
      const signed = parseStatementAmount(cells[mapping.amount] ?? "");
      if (signed !== null && signed !== 0) {
        const hint = parseDrCrCell(mapping.drcr !== undefined ? cells[mapping.drcr] : undefined);
        // An explicit Dr/Cr column wins; otherwise the sign decides.
        direction = hint ?? (signed < 0 ? "debit" : "credit");
        amount = Math.abs(signed);
      }
    } else {
      const debit = mapping.debit !== undefined ? parseStatementAmount(cells[mapping.debit] ?? "") : null;
      const credit = mapping.credit !== undefined ? parseStatementAmount(cells[mapping.credit] ?? "") : null;
      // Split columns: exactly one side should carry a nonzero value. When a
      // sheet fills both (rare), the larger magnitude wins.
      const d = debit !== null ? Math.abs(debit) : 0;
      const c = credit !== null ? Math.abs(credit) : 0;
      if (d > 0 || c > 0) {
        direction = d >= c && d > 0 ? "debit" : "credit";
        amount = Math.max(d, c);
      }
    }

    if (amount === null || amount <= 0 || direction === null) {
      skippedRows++;
      continue;
    }

    const narration = (cells[mapping.narration] ?? "").trim();
    const refNo = mapping.ref !== undefined ? (cells[mapping.ref] ?? "").trim() || undefined : undefined;
    const { category, type } = categorizeNarration(narration, direction);

    rows.push({
      sourceIndex: i,
      dateISO,
      rawDate: (cells[mapping.date] ?? "").trim(),
      narration,
      cleanedNarration: cleanNarration(narration) || "(no narration)",
      amount,
      direction,
      refNo,
      suggestedCategory: category,
      suggestedType: type,
    });
  }

  return { rows, skippedRows };
}

// ─── Header detection ────────────────────────────────────────────────────────
/** How many leading grid rows to scan for the header before giving up. */
const HEADER_SCAN_LIMIT = 40;

/**
 * Best-guess header row when full auto-detection failed: the widest row with
 * mostly non-numeric, non-empty cells in the scan window — what the manual
 * mapper offers as column labels.
 */
function guessHeaderRow(grid: string[][]): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(grid.length, HEADER_SCAN_LIMIT);
  for (let i = 0; i < limit; i++) {
    const cells = grid[i] ?? [];
    const filled = cells.filter((c) => c?.trim()).length;
    const texty = cells.filter((c) => c?.trim() && !/^[\d,.()\-₹\s]+$/.test(c)).length;
    const score = filled + texty * 2;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

// ─── Entry point ─────────────────────────────────────────────────────────────
/**
 * Parse a raw CSV string into staged statement rows. Never throws — every
 * failure mode is a typed result the drawer can render.
 */
export function parseStatementCsv(csvText: string): ParseResult {
  const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: "greedy" });
  // Papaparse reports recoverable structural issues (ragged rows etc.) as
  // errors while still returning data — only a fully empty grid is fatal.
  const grid = (parsed.data ?? []).filter((r): r is string[] => Array.isArray(r));
  if (grid.length === 0) {
    return { status: "error", reason: "The file is empty or isn't a readable CSV." };
  }

  // Scan past preamble/metadata lines for header candidates. ALL candidates
  // in the window are evaluated and the highest-yielding one wins — taking
  // the FIRST match would let a summary block above the real table (card
  // statements often carry one, with header-ish names like "Statement Date /
  // Transaction Details / Total Amount Due") hijack the column positions and
  // misalign the entire import.
  const limit = Math.min(grid.length, HEADER_SCAN_LIMIT);
  let best:
    | { mapping: ColumnMapping; headerRowIndex: number; rows: ParsedStatementRow[]; skippedRows: number }
    | null = null;
  for (let i = 0; i < limit; i++) {
    const mapping = mappingFromHeaderRow(grid[i]);
    if (!mapping) continue;
    const { rows, skippedRows } = applyMapping(grid, i, mapping);
    if (rows.length === 0) continue; // header-shaped row with no parsable data below
    if (!best || rows.length > best.rows.length) {
      best = { mapping, headerRowIndex: i, rows, skippedRows };
    }
  }
  if (best) {
    return {
      status: "ok",
      rows: best.rows,
      mapping: best.mapping,
      headers: grid[best.headerRowIndex].map((h) => h.trim()),
      headerRowIndex: best.headerRowIndex,
      skippedRows: best.skippedRows,
      grid,
    };
  }

  // Auto-detection failed — hand the grid to the manual mapper.
  const headerRowIndex = guessHeaderRow(grid);
  const headers = (grid[headerRowIndex] ?? []).map((h, idx) => h.trim() || `Column ${idx + 1}`);
  if (grid.length - headerRowIndex < 2) {
    return { status: "error", reason: "No transaction rows found below the header." };
  }
  return {
    status: "needs-mapping",
    headers,
    headerRowIndex,
    grid,
    reason:
      "Couldn't auto-detect the Date / Narration / Amount columns — map them manually below.",
  };
}
