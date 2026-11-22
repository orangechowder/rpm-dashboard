// Money is ALWAYS an integer number of cents. Nothing in lib/money multiplies or divides a dollar
// amount as a floating-point number; percentages are display-only ratios computed from cents.

export type Cents = number;
export type Lang = "en" | "fr";

/** Integer division rounded half away from zero (exact for any safe integer, via BigInt). */
export function divRound(numerator: number | bigint, denominator: number | bigint): number {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (d === BigInt(0)) throw new Error("divide by zero");
  const negative = (n < BigInt(0)) !== (d < BigInt(0));
  const an = n < BigInt(0) ? -n : n;
  const ad = d < BigInt(0) ? -d : d;
  const q = (an * BigInt(2) + ad) / (ad * BigInt(2));
  return Number(negative ? -q : q);
}

export function assertCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) throw new Error(`Not an integer number of cents: ${value}`);
  return value;
}

export function sumCents(values: Iterable<number>): Cents {
  let total = 0;
  for (const value of values) total += assertCents(value);
  return assertCents(total);
}

/**
 * Parses what a person types ("1234.56", "1,234.56", "1 234,56", "$12", "12,5", "-4.10") into cents
 * without ever going through a float. Returns null when it isn't a clear amount.
 */
export function parseMoney(input: string): Cents | null {
  let text = String(input ?? "").trim().replace(/[\s  ]/g, "").replace(/\$/g, "").replace(/CAD$/i, "");
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  if (text.startsWith("-")) { negative = true; text = text.slice(1); }
  else if (text.endsWith("-")) { negative = true; text = text.slice(0, -1); }
  if (!/^[0-9.,]+$/.test(text)) return null;
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let intPart = text;
  let fracPart = "";
  const sep = Math.max(lastDot, lastComma);
  if (sep >= 0) {
    const after = text.slice(sep + 1);
    const sepChar = text[sep];
    const otherChar = sepChar === "." ? "," : ".";
    const sepCount = text.split(sepChar).length - 1;
    // "1,234" or "1.234.567": a single separator followed by exactly 3 digits with no other kind → thousands.
    const isThousands = after.length === 3 && (sepCount > 1 || (!text.includes(otherChar) && sepChar === ","));
    if (!isThousands && after.length <= 2) {
      intPart = text.slice(0, sep);
      fracPart = after;
    } else if (isThousands || after.length === 3) {
      intPart = text;
      fracPart = "";
    } else {
      return null;
    }
  }
  // Grouping must look like real thousands groups: 1,234,567 or 1.234.567 or 1 234 (spaces already removed).
  if (/[.,]/.test(intPart)) {
    const groupChar = intPart.includes(".") ? "." : ",";
    if (intPart.includes(groupChar === "." ? "," : ".")) return null;
    const groups = intPart.split(groupChar);
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some((g) => !/^\d{3}$/.test(g))) return null;
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (intPart === "") intPart = "0";
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(fracPart)) return null;
  const cents = Number(intPart) * 100 + Number((fracPart + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

function groupDigits(digits: string, separator: string) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** $1,234.56 (EN) / 1 234,56 $ (FR, Québec style). Built from the integer, no float rounding. */
export function formatMoney(cents: Cents, lang: Lang = "en", options: { sign?: boolean; whole?: boolean } = {}): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  let dollars = Math.floor(abs / 100);
  let rest = abs % 100;
  if (options.whole) { dollars = Math.floor((abs + 50) / 100); rest = 0; }
  const body = lang === "fr"
    ? `${groupDigits(String(dollars), " ")}${options.whole ? "" : `,${String(rest).padStart(2, "0")}`} $`
    : `$${groupDigits(String(dollars), ",")}${options.whole ? "" : `.${String(rest).padStart(2, "0")}`}`;
  if (negative) return `−${body}`;
  if (options.sign && cents > 0) return `+${body}`;
  return body;
}

/** Short axis labels: $60K, -$30K, $1.2M. */
export function formatMoneyShort(cents: Cents, lang: Lang = "en"): string {
  const dollars = cents / 100; // display only
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? "-" : "";
  let text: string;
  if (abs >= 1_000_000) text = `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  else if (abs >= 1000) text = `${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  else text = `${Math.round(abs)}`;
  if (lang === "fr") return `${sign}${text.replace(".", ",")} $`;
  return `${sign}$${text}`;
}

/** Ratio for display (margins, % change). null when the base is zero, like the spreadsheet's IF(x=0,""). */
export function ratio(part: Cents, whole: Cents): number | null {
  if (whole === 0) return null;
  return part / whole;
}

export function formatPercent(value: number | null, lang: Lang = "en", options: { sign?: boolean; digits?: number } = {}): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const digits = options.digits ?? 1;
  const pct = value * 100;
  let text = Math.abs(pct).toFixed(digits);
  if (lang === "fr") text = text.replace(".", ",");
  const sign = pct < 0 ? "−" : options.sign && pct > 0 ? "+" : "";
  return lang === "fr" ? `${sign}${text} %` : `${sign}${text}%`;
}

/** Plain-input value for an edit field: 1234.56 / 1234,56 (no grouping). */
export function centsToInput(cents: Cents, lang: Lang = "en"): string {
  const abs = Math.abs(cents);
  const text = `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}${lang === "fr" ? "," : "."}${String(abs % 100).padStart(2, "0")}`;
  return text;
}
