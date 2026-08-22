/**
 * Client-side tradebook CSV parser for Indian broker equity exports (Zerodha
 * Console, Groww, Dhan, and a fuzzy generic fallback).
 *
 * Architecturally this mirrors csvStatementParser.ts closely on purpose —
 * same house pattern: preamble/header scanning, fuzzy header synonym
 * matching, a typed ParseResult ("ok" | "needs-mapping" | "error"), and a
 * needs-mapping escape hatch carrying the raw grid for manual column mapping.
 * Date normalization is imported from there rather than re-implemented.
 *
 * IMPORTANT MODELING NOTE — why this parser only classifies BUY/SELL and
 * does not itself decide what becomes a Trade:
 * FinStride's Trade model (src/lib/store.tsx) represents one LONG swing
 * position with a planned targetPrice/stopLoss and an open/closed lifecycle —
 * it has no concept of a standalone execution fill. A tradebook's BUY rows
 * map cleanly onto "open a new position" (entryDate/entryPrice/qty), but a
 * SELL row represents EXITING a position that must already exist somewhere —
 * there is no such thing as "a new LONG trade whose first event is a sell".
 * Reconciling sells against opens (lot-matching, partial fills, FIFO) is a
 * real feature in its own right that full brokerage tools spend a lot of
 * surface area on; this parser deliberately stays a dumb, honest CSV reader
 * that reports what each row IS (a buy or a sell fill) and leaves the
 * decision of what to DO with that to the import UI, which is where the
 * user's actual open positions are known.
 */

import Papa from "papaparse";
import { normalizeStatementDate, parseStatementAmount } from "./csvStatementParser";

// ─── Result shapes ───────────────────────────────────────────────────────────
export type TradeSide = "buy" | "sell";

export type ParsedTradeRow = {
  /** Position in the source grid — stable identity for the staging UI. */
  sourceIndex: number;
  dateISO: string;
  rawDate: string;
  symbol: string;
  rawSymbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  /** The broker's own trade/order id for this fill, when the export has one — used to fingerprint a SELL execution so re-importing an overlapping tradebook can't re-apply the same close twice. Undefined when no such column was found (the importer falls back to a synthetic date+symbol+qty+price key). */
  executionId?: string;
};

export type TradeColumnMapping = {
  symbol: number;
  date: number;
  side: number;
  quantity: number;
  price: number;
  /** Optional — most exports don't carry a distinct trade/order id column, and its absence must never block an otherwise-valid header match. */
  executionId?: number;
};

export type TradeParseSuccess = {
  status: "ok";
  rows: ParsedTradeRow[];
  mapping: TradeColumnMapping;
  headers: string[];
  headerRowIndex: number;
  skippedRows: number;
  grid: string[][];
};

export type TradeParseNeedsMapping = {
  status: "needs-mapping";
  headers: string[];
  headerRowIndex: number;
  grid: string[][];
  reason: string;
};

export type TradeParseFailure = { status: "error"; reason: string };

export type TradeParseResult = TradeParseSuccess | TradeParseNeedsMapping | TradeParseFailure;

// ─── Fuzzy header matching ───────────────────────────────────────────────────
function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Order is priority order — when a sheet carries more than one plausible
// match (Groww ships both "Order Date" and "Execution Date"), the first
// listed alias wins.
const SYMBOL_HEADERS = ["symbol", "tradingsymbol", "stockname", "scripname", "name", "ticker", "instrument"];
const DATE_HEADERS = [
  "tradedate", "executiondate", "tradetime", "orderdate", "date", "transactiondate", "exectime",
];
const SIDE_HEADERS = ["tradetype", "buysell", "side", "type", "transactiontype", "action"];
const QUANTITY_HEADERS = ["quantity", "qty", "tradedqty", "filledqty"];
const PRICE_HEADERS = ["price", "averageprice", "avgprice", "tradeprice", "rate"];
const TRADE_ID_HEADERS = [
  "tradeid", "orderid", "exchangetradeid", "exchangeorderid", "tradenumber", "orderno", "orderreference",
];

/**
 * Headers that CONTAIN a symbol synonym by accident but never hold a ticker —
 * "Client Name", "Account Name", "Instrument Type" all contain "name"/
 * "instrument", which are legitimate EXACT headers (Dhan really does call its
 * column "Name") but false hits on the containment pass. Binding one of
 * these would stage every row with the account holder's name or a segment
 * code as its "ticker" — mirrors csvStatementParser's VALUE_HEADER_TRAPS.
 */
const SYMBOL_HEADER_TRAPS = /(client|account|instrumenttype|segment)/;

function findColumn(normalized: string[], synonyms: string[], traps?: RegExp): number | undefined {
  for (const syn of synonyms) {
    const exact = normalized.findIndex((h) => h === syn);
    if (exact >= 0) return exact;
  }
  for (const syn of synonyms) {
    if (syn.length <= 2) continue;
    const contains = normalized.findIndex((h) => h.includes(syn) && !(traps && traps.test(h)));
    if (contains >= 0) return contains;
  }
  return undefined;
}

/**
 * Try to interpret one grid row as the tradebook header. Rejects a candidate
 * outright if two fields resolved to the SAME column — a header cell whose
 * text happens to satisfy two synonym sets at once ("Rate Type" contains
 * both PRICE_HEADERS' bare "rate" and SIDE_HEADERS' bare "type") must not
 * silently bind one column to two different meanings.
 */
function mappingFromHeaderRow(row: string[]): TradeColumnMapping | null {
  const normalized = row.map(normalizeHeader);
  const symbol = findColumn(normalized, SYMBOL_HEADERS, SYMBOL_HEADER_TRAPS);
  const date = findColumn(normalized, DATE_HEADERS);
  const side = findColumn(normalized, SIDE_HEADERS);
  const quantity = findColumn(normalized, QUANTITY_HEADERS);
  const price = findColumn(normalized, PRICE_HEADERS);
  if (
    symbol === undefined ||
    date === undefined ||
    side === undefined ||
    quantity === undefined ||
    price === undefined
  ) {
    return null;
  }
  const indices = [symbol, date, side, quantity, price];
  if (new Set(indices).size !== indices.length) return null;
  // Optional sixth column — a header without one still matches (unlike the
  // five above, which are all required), and a spurious collision with one
  // of the required columns is simply dropped rather than rejecting the
  // whole header.
  const executionIdCandidate = findColumn(normalized, TRADE_ID_HEADERS);
  const executionId =
    executionIdCandidate !== undefined && !indices.includes(executionIdCandidate)
      ? executionIdCandidate
      : undefined;
  return { symbol, date, side, quantity, price, executionId };
}

// ─── Symbol cleaning ─────────────────────────────────────────────────────────
/** Real NSE/BSE tickers never run this long — a defensive cap against a malformed CSV cell. */
const MAX_TICKER_LEN = 24;

/**
 * "NSE:RELIANCE-EQ" -> "RELIANCE". Strips exchange prefixes (NSE:/BSE:/NFO:)
 * and the series suffixes NSE/BSE equity tickers commonly carry in broker
 * exports (-EQ delivery, -BE trade-to-trade, -BZ, -BL, -SM SME).
 */
export function cleanTicker(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/^(NSE|BSE|NFO):/, "")
    .replace(/-(EQ|BE|BZ|BL|SM)$/, "")
    .trim()
    .slice(0, MAX_TICKER_LEN);
}

// ─── Side normalization ──────────────────────────────────────────────────────
function normalizeSide(raw: string): TradeSide | null {
  const s = raw.trim().toLowerCase();
  if (/^(buy|b|bought|long)$/.test(s)) return "buy";
  if (/^(sell|s|sold|short)$/.test(s)) return "sell";
  return null;
}

// ─── Row extraction ──────────────────────────────────────────────────────────
export function applyTradeMapping(
  grid: string[][],
  headerRowIndex: number,
  mapping: TradeColumnMapping,
): { rows: ParsedTradeRow[]; skippedRows: number } {
  const rows: ParsedTradeRow[] = [];
  let skippedRows = 0;

  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!cells || cells.every((c) => !c?.trim())) continue; // blank spacer line — not worth counting

    const dateISO = normalizeStatementDate(cells[mapping.date] ?? "");
    const side = normalizeSide(cells[mapping.side] ?? "");
    const rawSymbol = (cells[mapping.symbol] ?? "").trim();
    const symbol = cleanTicker(rawSymbol);
    // parseStatementAmount (shared with csvStatementParser) strips ₹/Rs/INR
    // prefixes and lakh-comma grouping — a plain Number()+comma-strip missed
    // currency-symbol-prefixed cells entirely, silently dropping valid rows.
    const quantity = parseStatementAmount(cells[mapping.quantity] ?? "");
    const price = parseStatementAmount(cells[mapping.price] ?? "");

    if (
      !dateISO ||
      !side ||
      !rawSymbol ||
      !symbol || // rawSymbol can be non-empty but clean to "" (e.g. a stray "NSE:" or "-EQ" with no ticker)
      quantity === null ||
      quantity <= 0 ||
      price === null ||
      price <= 0
    ) {
      skippedRows++;
      continue;
    }

    const executionIdRaw =
      mapping.executionId !== undefined ? (cells[mapping.executionId] ?? "").trim() : "";

    rows.push({
      sourceIndex: i,
      dateISO,
      rawDate: (cells[mapping.date] ?? "").trim(),
      symbol,
      // Only used for display/tooltip/notes — capped so a malformed row
      // (e.g. an unmatched CSV quote swallowing the rest of the file into
      // one cell) can't blow out layout or bloat a persisted Trade record.
      rawSymbol: rawSymbol.slice(0, 60),
      side,
      quantity,
      price,
      // Capped for the same reason rawSymbol is — a stray broken-quote row
      // must not be able to smuggle an oversized value into a fingerprint.
      executionId: executionIdRaw ? executionIdRaw.slice(0, 60) : undefined,
    });
  }

  return { rows, skippedRows };
}

// ─── Header detection ────────────────────────────────────────────────────────
const HEADER_SCAN_LIMIT = 40;

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
 * Parse a raw tradebook CSV string into staged trade rows. Never throws —
 * every failure mode is a typed result the modal can render.
 */
export function parseTradebookCsv(csvText: string): TradeParseResult {
  const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: "greedy" });
  const grid = (parsed.data ?? []).filter((r): r is string[] => Array.isArray(r));
  if (grid.length === 0) {
    return { status: "error", reason: "The file is empty or isn't a readable CSV." };
  }

  // Evaluate every candidate header row in the scan window and take the
  // highest-yielding one — the same max-yield selection csvStatementParser
  // uses, so a summary block or account-info preamble above the real
  // tradebook table can't hijack the column positions.
  const limit = Math.min(grid.length, HEADER_SCAN_LIMIT);
  let best:
    | { mapping: TradeColumnMapping; headerRowIndex: number; rows: ParsedTradeRow[]; skippedRows: number }
    | null = null;
  for (let i = 0; i < limit; i++) {
    const mapping = mappingFromHeaderRow(grid[i]);
    if (!mapping) continue;
    const { rows, skippedRows } = applyTradeMapping(grid, i, mapping);
    if (rows.length === 0) continue;
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

  const headerRowIndex = guessHeaderRow(grid);
  const headers = (grid[headerRowIndex] ?? []).map((h, idx) => h.trim() || `Column ${idx + 1}`);
  if (grid.length - headerRowIndex < 2) {
    return { status: "error", reason: "No trade rows found below the header." };
  }
  return {
    status: "needs-mapping",
    headers,
    headerRowIndex,
    grid,
    reason:
      "Couldn't auto-detect the Symbol / Date / Type / Quantity / Price columns — map them manually below.",
  };
}
