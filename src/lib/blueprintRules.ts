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
