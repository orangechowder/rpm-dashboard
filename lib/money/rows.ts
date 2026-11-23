// Database row → MoneyEntry. Shared by the browser repository and the server routes (no client code here).
import type { TaxMode } from "./tax";
import type { MoneyEntry } from "./types";

export type Row = Record<string, unknown>;
export const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export const int = (v: unknown) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`Bad cents value from database: ${String(v)}`);
  return n;
};

export function rowToEntry(row: Row): MoneyEntry {
  return {
    id: str(row.id),
    kind: row.kind === "in" ? "in" : "out",
    date: str(row.entry_date),
    categoryId: str(row.category_id),
    party: str(row.party_name),
    description: str(row.description),
    totalCents: int(row.total_cents),
    gstCents: int(row.gst_cents),
    qstCents: int(row.qst_cents),
    netCents: int(row.net_cents),
    taxesIncluded: Boolean(row.taxes_included),
    paymentMethod: row.payment_method ? str(row.payment_method) : null,
    paid: Boolean(row.paid),
    paidOn: row.paid_on ? str(row.paid_on) : null,
    receiptPath: row.receipt_path ? str(row.receipt_path) : null,
    receiptRef: row.receipt_ref ? str(row.receipt_ref) : "",
    recurringId: row.recurring_id ? str(row.recurring_id) : null,
    occurrenceDate: row.occurrence_date ? str(row.occurrence_date) : null,
    source: (["manual", "recurring", "import", "wave"].includes(str(row.source)) ? str(row.source) : "manual") as MoneyEntry["source"],
    importKey: row.import_key ? str(row.import_key) : null,
    createdBy: row.created_by ? str(row.created_by) : null,
    createdAt: str(row.created_at),
    updatedBy: row.updated_by ? str(row.updated_by) : null,
    updatedAt: str(row.updated_at),
    deletedAt: row.deleted_at ? str(row.deleted_at) : null,
    deletedBy: row.deleted_by ? str(row.deleted_by) : null,
  };
}


/** A category's tax setting (older rows without it fall back to "taxable yes/no"). */
export function toTaxMode(value: unknown, taxable = true): TaxMode {
  return value === "gst_qst" || value === "gst_only" || value === "none" ? value : taxable ? "gst_qst" : "none";
}
