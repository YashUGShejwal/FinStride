/**
 * Cross-cutting Swing Desk business rules — kept separate from
 * src/routes/_authenticated/swing.tsx (a route file, scanned/codegen'd by
 * @tanstack/router-plugin) so other modules that need the same rule
 * (TradeImportModal, at minimum) can import it without creating a
 * route-file <-> component circular dependency. A route file should stay a
 * dependency leaf, not something else imports from.
 */

/**
 * Blueprint Rule 2 — F&O ban (always active). Equity swing trading only.
 *
 * The original pattern only caught MONTHLY contract symbols
 * ("NIFTY24DEC24500CE") via its \d{2}(JAN|FEB|...) alternation — real NSE
 * WEEKLY contracts (the most heavily traded F&O product) use a single
 * month-code character instead of a 3-letter month name, e.g.
 * "NIFTY24O2824500CE" (24 = year, O = October, 28 = day, 24500 = strike),
 * which that alternation can never match, and the bare \b(NIFTY|...)\b
 * alternation also failed since the index name is glued directly to a digit
 * with no word boundary between them. This rewrite drops month-name parsing
 * entirely and instead matches on what's structurally true of EVERY option/
 * future symbol regardless of expiry format:
 *   - an index/derivative underlying name directly followed by a digit
 *     (covers NIFTY/BANKNIFTY/FINNIFTY/SENSEX/MIDCPNIFTY/BANKEX contracts,
 *     weekly or monthly, options or futures), or
 *   - the string ending in a digit immediately followed by CE/PE (every
 *     option contract, any underlying — stock or index — since no real NSE
 *     equity ticker ends in a strike-price-shaped "<digits>CE"/"<digits>PE"), or
 *   - the string ending in "FUT" (every futures contract, stock or index).
 */
export const FNO_REGEX = /(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|BANKEX)\d|\d(CE|PE)$|FUT$/i;

// ─── F&O symbol decoding (optional F&O Desk — gated on user_settings.enable_fno_tracking) ──
export type FnoContractInfo = {
  /** Underlying name, e.g. "NIFTY", "RELIANCE". */
  instrument: string;
  /** Best-effort human string — e.g. "Dec-2024" (monthly) or "Weekly 2024 (Oct)" (weekly — see below). */
  expiry: string;
  /** null for futures, or for a weekly contract (see below) where it can't be reliably separated from the expiry day. */
  strike: number | null;
  optionType: "CE" | "PE" | "FUT";
};

const MONTHLY_FNO_RE =
  /^([A-Z]+?)(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d*)$/;
const MONTH_DISPLAY: Record<string, string> = {
  JAN: "Jan", FEB: "Feb", MAR: "Mar", APR: "Apr", MAY: "May", JUN: "Jun",
  JUL: "Jul", AUG: "Aug", SEP: "Sep", OCT: "Oct", NOV: "Nov", DEC: "Dec",
};

// NSE weekly contracts encode the expiry as YY + a single-letter month code
// (1-9 for Jan-Sep, O/N/D for Oct/Nov/Dec) + DD, e.g. "NIFTY24O2824500CE" =
// year 24, October, day 28, strike 24500.
const WEEKLY_FNO_RE = /^([A-Z]+?)(\d{2})([1-9OND])(\d+)$/;
const WEEKLY_MONTH_DISPLAY: Record<string, string> = {
  "1": "Jan", "2": "Feb", "3": "Mar", "4": "Apr", "5": "May", "6": "Jun",
  "7": "Jul", "8": "Aug", "9": "Sep", O: "Oct", N: "Nov", D: "Dec",
};

/**
 * Best-effort decode of an NSE F&O tradingsymbol into its human-readable
 * parts, for the optional F&O Desk view. Returns null when `symbol` doesn't
 * match either recognized shape (caller falls back to showing the raw symbol
 * with contract columns blank).
 *
 * MONTHLY contracts (NAME + YY + 3-letter month + strike, e.g.
 * "NIFTY24DEC24500CE") decode fully and reliably — the 3-letter month code
 * is an unambiguous separator between the year and the strike digits.
 *
 * WEEKLY contracts (NAME + YY + single-letter month + DD + strike, e.g.
 * "NIFTY24O2824500CE") decode instrument/expiry-year/optionType only. The
 * day and strike are both plain digit runs with no separator between them —
 * "2824500" is day "28" + strike "24500", but nothing in the string says
 * where one ends and the other begins. Guessing a split would risk showing a
 * confidently WRONG strike, which is worse than showing none, so this
 * deliberately leaves `strike: null` and a coarse `expiry` for weekly
 * contracts rather than a false-precision day+strike.
 */
export function decodeFnoSymbol(symbol: string): FnoContractInfo | null {
  const s = symbol.trim().toUpperCase();
  let optionType: "CE" | "PE" | "FUT";
  let body: string;
  if (s.endsWith("CE")) {
    optionType = "CE";
    body = s.slice(0, -2);
  } else if (s.endsWith("PE")) {
    optionType = "PE";
    body = s.slice(0, -2);
  } else if (s.endsWith("FUT")) {
    optionType = "FUT";
    body = s.slice(0, -3);
  } else {
    return null;
  }

  const monthly = MONTHLY_FNO_RE.exec(body);
  if (monthly) {
    const [, instrument, yy, mon, strikeDigits] = monthly;
    // A future has no strike; an option must have one — either mismatch
    // means this isn't really the monthly shape (e.g. leftover digits).
    if (optionType === "FUT" ? strikeDigits.length > 0 : strikeDigits.length === 0) return null;
    return {
      instrument,
      expiry: `${MONTH_DISPLAY[mon]}-20${yy}`,
      strike: strikeDigits ? Number(strikeDigits) : null,
      optionType,
    };
  }

  if (optionType !== "FUT") {
    const weekly = WEEKLY_FNO_RE.exec(body);
    if (weekly) {
      const [, instrument, yy, monLetter] = weekly;
      return {
        instrument,
        expiry: `Weekly 20${yy} (${WEEKLY_MONTH_DISPLAY[monLetter]})`,
        strike: null,
        optionType,
      };
    }
  }

  return null;
}

/**
 * The underlying root for any symbol: an F&O contract's instrument name
 * (NIFTY, BANKNIFTY, RELIANCE, ...), or the symbol itself unchanged for a
 * plain equity ticker that was never a contract to begin with. Thin wrapper
 * around decodeFnoSymbol — a plain equity ticker never matches either F&O
 * shape there, so it always falls through to the "leave it as-is" branch.
 *
 * Lets every strike/expiry of the same underlying (RELIANCE24AUG2900CE,
 * RELIANCE24AUG2950CE, RELIANCE24SEPFUT, ...) collapse under one master
 * group in the Swing Desk's "By Symbol & Date" view instead of each exact
 * contract string getting its own separate card.
 */
export function getUnderlyingSymbol(rawSymbol: string): string {
  return decodeFnoSymbol(rawSymbol)?.instrument ?? rawSymbol;
}
