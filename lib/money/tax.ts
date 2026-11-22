// Québec sales taxes. RPM Diesel is registered for both GST (TPS) and QST (TVQ).
// Both are calculated on the amount before taxes (QST is not charged on GST since 2013).
// Each line is rounded ONCE, and net + GST + QST always equals the total exactly.
import { assertCents, divRound, type Cents } from "./cents";

export const GST_RATE = { numerator: 5, denominator: 100 } as const; // 5 %
export const QST_RATE = { numerator: 9975, denominator: 100000 } as const; // 9.975 %
/** 1 + 5 % + 9.975 % = 1.14975 */
const COMBINED = { numerator: 114975, denominator: 100000 } as const;

export type TaxSplit = { netCents: Cents; gstCents: Cents; qstCents: Cents; totalCents: Cents };

export function gstOn(netCents: Cents): Cents {
  return divRound(BigInt(assertCents(netCents)) * BigInt(GST_RATE.numerator), GST_RATE.denominator);
}

export function qstOn(netCents: Cents): Cents {
  return divRound(BigInt(assertCents(netCents)) * BigInt(QST_RATE.numerator), QST_RATE.denominator);
}

/** The person typed the total they paid/received, taxes included: split it. */
export function splitTaxesIncluded(totalCents: Cents): TaxSplit {
  assertCents(totalCents);
  const estimatedNet = divRound(BigInt(totalCents) * BigInt(COMBINED.denominator), COMBINED.numerator);
  const gstCents = gstOn(estimatedNet);
  const qstCents = qstOn(estimatedNet);
  // The net absorbs any 1-cent difference so the line always adds up to what was actually paid.
  const netCents = totalCents - gstCents - qstCents;
  return { netCents, gstCents, qstCents, totalCents };
}

/** The person typed an amount before taxes: add them. */
export function addTaxes(netCents: Cents): TaxSplit {
  const gstCents = gstOn(netCents);
  const qstCents = qstOn(netCents);
  return { netCents, gstCents, qstCents, totalCents: netCents + gstCents + qstCents };
}

export function noTaxes(totalCents: Cents): TaxSplit {
  return { netCents: assertCents(totalCents), gstCents: 0, qstCents: 0, totalCents };
}

/** Manual override (receipt shows slightly different taxes). Returns null if it can't be right. */
export function manualTaxes(totalCents: Cents, gstCents: Cents, qstCents: Cents): TaxSplit | null {
  if (![totalCents, gstCents, qstCents].every(Number.isSafeInteger)) return null;
  if (gstCents < 0 || qstCents < 0 || gstCents + qstCents > totalCents) return null;
  return { netCents: totalCents - gstCents - qstCents, gstCents, qstCents, totalCents };
}
