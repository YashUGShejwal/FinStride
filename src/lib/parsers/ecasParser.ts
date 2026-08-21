/**
 * Client-side CDSL/NSDL eCAS (Consolidated Account Statement) PDF parser.
 *
 * Everything runs in the browser: the PDF bytes and the user's password never
 * leave the device — pdf.js decrypts and extracts text entirely in-memory
 * (via its own web worker), and nothing in this module makes a network call.
 *
 * pdfjs-dist is a heavy, browser/worker-only dependency (Workers, no Node
 * entry this app relies on), and this app is server-rendered (TanStack
 * Start). It must NEVER be a static top-level import anywhere it could reach
 * the SSR bundle. This whole module is therefore only ever loaded via a
 * dynamic `import()` from a client event handler (see EcasImportDialog) —
 * never imported eagerly, and never touched during render.
 *
 * eCAS layouts vary meaningfully between CDSL/NSDL and across broker
 * back-office systems, and there is no way to unit-test this against a real
 * statement without a live PAN-holder's actual document. The extraction below
 * is a best-effort heuristic: every candidate it finds still goes through the
 * dialog's manual review/mapping step before anything is committed, and it
 * never silently drops money it found evidence of — an unrecognized source
 * still surfaces as a row with whatever label was nearby.
 */

import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import { normalizeStatementDate } from "./csvStatementParser";

GlobalWorkerOptions.workerSrc = pdfjsWorker;

// ─── Result shapes ───────────────────────────────────────────────────────────
export type EcasHoldingCategory = "equity_swing" | "long_term_etf" | "mutual_funds";

export type EcasHolding = {
  sourceName: string;
  amount: number;
  category: EcasHoldingCategory;
};

/** Matches the requested public shape exactly — the success payload. */
export type EcasParseResult = {
  statementDate: string;
  holdings: EcasHolding[];
  rawTextPreview?: string;
};

/**
 * The function's actual return type. Password/format failures are expected,
 * routine outcomes for a user-supplied PDF — they're data the dialog renders,
 * not exceptions to catch, mirroring the ParseResult pattern already used by
 * the CSV statement importer (src/lib/parsers/csvStatementParser.ts).
 */
export type EcasParseOutcome =
  | ({ status: "ok" } & EcasParseResult)
  | { status: "password-required" }
  | { status: "wrong-password" }
  | { status: "error"; reason: string };

// ─── Known DP / broker aliases ───────────────────────────────────────────────
// Substring aliases (brand name + known legal-entity variants), matched
// case-insensitively against extracted lines. Legal entity names shift over
// time (rebrands, corporate restructuring) and eCAS layouts render them
// inconsistently, so this list is deliberately generous rather than exact —
// a miss here just means the row surfaces under its raw statement label
// instead of a friendly one; the mapping step (EcasImportDialog) still lets
// the user route it to the right brokerPartition regardless.
const BROKER_ALIASES: { label: string; aliases: string[] }[] = [
  { label: "Zerodha", aliases: ["zerodha"] },
  { label: "Groww", aliases: ["groww", "nextbillion"] },
  { label: "Dhan", aliases: ["dhan", "raise financial"] },
  { label: "Angel One", aliases: ["angel one", "angel broking"] },
  { label: "Upstox", aliases: ["upstox", "rksv"] },
  { label: "ICICI Securities", aliases: ["icici securities", "icicidirect"] },
  { label: "HDFC Securities", aliases: ["hdfc securities", "hdfc sec "] },
];

const MF_SECTION_ALIASES = ["mutual fund", "amc name", "folio no", "scheme name"];
const ETF_HINT = /\betf\b/i;

/** Lines containing one of these near a value make that value a HIGH-confidence total. */
const VALUE_KEYWORDS = /\b(value|valuation|total|market\s*value|current\s*value|amount)\b/i;

// ─── Text extraction ─────────────────────────────────────────────────────────
/**
 * All text on one page, grouped into lines using pdf.js's own `hasEOL` flag
 * (true when the NEXT item starts a new line) rather than raw item order —
 * items in a row of a table are otherwise concatenated with no separator.
 */
async function extractPageLines(pdf: PDFDocumentProxy, pageNum: number): Promise<string[]> {
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  const lines: string[] = [];
  let current = "";
  for (const item of content.items) {
    if (!("str" in item)) continue; // TextMarkedContent — no text of its own
    current += (current && item.str ? " " : "") + item.str;
    if (item.hasEOL) {
      lines.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.filter((l) => l.length > 0);
}

async function extractAllLines(pdf: PDFDocumentProxy): Promise<string[]> {
  const lines: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    lines.push(...(await extractPageLines(pdf, i)));
  }
  return lines;
}

// ─── Statement date detection ────────────────────────────────────────────────
// Broad net over the phrasings CDSL/NSDL and broker-generated eCAS PDFs
// actually use ("CAS Summary as of…", "Statement as on…", a bare date near
// "as on"/"as of", or a "Period: … to <end>" range where the END date is what
// the snapshot should be dated against).
const DATE_TOKEN = "([0-9]{1,2}[-/.\\s][A-Za-z0-9]{2,9}[-/.\\s][0-9]{2,4})";
const DATE_PATTERNS = [
  new RegExp(`CAS\\s+Summary\\s+as\\s+(?:of|on)\\s+${DATE_TOKEN}`, "i"),
  new RegExp(`Statement\\s+as\\s+(?:of|on)\\s+${DATE_TOKEN}`, "i"),
  new RegExp(`as\\s+(?:of|on)\\s+${DATE_TOKEN}`, "i"),
  new RegExp(`(?:to|–|-)\\s*${DATE_TOKEN}\\s*$`, "i"), // trailing end-of-period date
];

/** Exported for testing against synthetic statement text — see csvStatementParser.ts's identical convention. */
export function detectStatementDate(lines: string[]): string {
  const text = lines.join("\n");
  for (const pattern of DATE_PATTERNS) {
    const m = text.match(pattern);
    if (!m) continue;
    const iso = normalizeStatementDate(m[1]);
    if (iso) return iso.slice(0, 10);
  }
  return "";
}

// ─── Value extraction ────────────────────────────────────────────────────────
/** Every decimal-formatted (2dp) currency-shaped number on a line, e.g. "1,25,430.50". */
function decimalAmountsOn(line: string): number[] {
  const matches = line.matchAll(/(?:₹|rs\.?|inr)?\s*([\d,]{1,3}(?:,\d{2,3})*\.\d{2})\b/gi);
  const out: number[] = [];
  for (const m of matches) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/** Whole-rupee fallback (no decimals) — only trusted with a thousands separator, to avoid picking up bare quantities/page numbers. */
function integerAmountsOn(line: string): number[] {
  const matches = line.matchAll(/(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+)\b/gi);
  const out: number[] = [];
  for (const m of matches) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/**
 * Best value in a window of lines following a source-name hit. Two-tier:
 * a line carrying a value keyword ("Value", "Total"…) wins outright; absent
 * that, fall back to the largest currency-shaped number in the window (a
 * summary total is virtually always the largest figure near per-line
 * quantities/prices). Returns null if nothing currency-shaped is present.
 */
function bestValueInWindow(windowLines: string[]): number | null {
  for (const line of windowLines) {
    if (!VALUE_KEYWORDS.test(line)) continue;
    const amounts = decimalAmountsOn(line);
    if (amounts.length > 0) return Math.max(...amounts);
  }
  const allDecimals = windowLines.flatMap(decimalAmountsOn);
  if (allDecimals.length > 0) return Math.max(...allDecimals);
  const allIntegers = windowLines.flatMap(integerAmountsOn);
  if (allIntegers.length > 0) return Math.max(...allIntegers);
  return null;
}

const BROKER_SCAN_WINDOW = 14;

/**
 * Scan for known-broker demat holdings — each hit's value comes from the
 * lines immediately following it. Exported for testing.
 */
export function extractBrokerHoldings(lines: string[]): EcasHolding[] {
  const holdings: EcasHolding[] = [];
  const seenCount = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    const hit = BROKER_ALIASES.find((b) => b.aliases.some((a) => lower.includes(a)));
    if (!hit) continue;

    const window = lines.slice(i, Math.min(lines.length, i + BROKER_SCAN_WINDOW));
    const amount = bestValueInWindow(window);
    if (amount === null) continue; // mention with no nearby value — likely boilerplate, not a holding

    const n = (seenCount.get(hit.label) ?? 0) + 1;
    seenCount.set(hit.label, n);
    const category: EcasHoldingCategory = window.some((l) => ETF_HINT.test(l))
      ? "long_term_etf"
      : "equity_swing";
    holdings.push({
      sourceName: n === 1 ? hit.label : `${hit.label} (${n})`,
      amount,
      category,
    });
  }
  return holdings;
}

/**
 * Mutual funds are modeled in this app as ONE partition-level figure (see the
 * built-in "Mutual Funds" BrokerPartition), not per-folio — so rather than
 * itemizing every AMC/folio line (which layouts render wildly differently),
 * this looks for ONE aggregate MF total and surfaces it as a single holding.
 * Exported for testing.
 */
export function extractMutualFundTotal(lines: string[]): EcasHolding | null {
  const sectionStart = lines.findIndex((l) => {
    const lower = l.toLowerCase();
    return MF_SECTION_ALIASES.some((a) => lower.includes(a));
  });
  if (sectionStart < 0) return null;
  const window = lines.slice(sectionStart, Math.min(lines.length, sectionStart + 60));
  // Prefer a line that pairs "total"/"grand total" with "mutual fund" —
  // otherwise fall back to the same keyword-or-largest heuristic as brokers.
  const grandTotalLine = window.find(
    (l) => /\btotal\b/i.test(l) && /mutual\s*fund/i.test(l),
  );
  const amount = grandTotalLine ? Math.max(...decimalAmountsOn(grandTotalLine), 0) || null : bestValueInWindow(window);
  if (!amount) return null;
  return { sourceName: "Mutual Funds", amount, category: "mutual_funds" };
}

// ─── Entry point ─────────────────────────────────────────────────────────────
export async function parseEcasPdf(data: ArrayBuffer, password: string): Promise<EcasParseOutcome> {
  const trimmedPassword = password.trim();
  const loadingTask = getDocument({ data, password: trimmedPassword || undefined });
  // One try/finally around the WHOLE function: destroy() must run on every
  // exit path, including a rejected loadingTask.promise (wrong password is
  // the single most common outcome on a first attempt) — an early return
  // from a narrower try block would skip cleanup on exactly that path and
  // leak the underlying pdf.js worker.
  try {
    let pdf: PDFDocumentProxy;
    try {
      pdf = await loadingTask.promise;
    } catch (err) {
      if (err && typeof err === "object" && "name" in err && err.name === "PasswordException") {
        const code = "code" in err ? err.code : undefined;
        return {
          status: code === PasswordResponses.NEED_PASSWORD ? "password-required" : "wrong-password",
        };
      }
      return {
        status: "error",
        reason: "Couldn't read this PDF — it may be corrupted or not a real eCAS statement.",
      };
    }

    const lines = await extractAllLines(pdf);
    if (lines.length === 0) {
      return { status: "error", reason: "No readable text found in this PDF." };
    }
    const holdings = extractBrokerHoldings(lines);
    const mf = extractMutualFundTotal(lines);
    if (mf) holdings.push(mf);

    return {
      status: "ok",
      statementDate: detectStatementDate(lines),
      holdings,
      rawTextPreview: lines.join("\n").slice(0, 2000),
    };
  } catch {
    return { status: "error", reason: "Couldn't extract text from this PDF." };
  } finally {
    // Cleanup lives on the loading task, not the resolved PDFDocumentProxy —
    // it releases the worker + decoded page/font caches. Safe to call
    // regardless of whether loading succeeded or failed.
    void loadingTask.destroy();
  }
}
