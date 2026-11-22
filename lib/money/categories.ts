// The 4 income and 17 expense lines of "RPM Diesel – Monthly/Quarterly Profitability.xlsx", in the
// same order. The ids are stable keys stored in the database (seeded by the Phase 1 migration).
export type MoneyKind = "in" | "out";

export type CategoryDef = {
  id: string;
  kind: MoneyKind;
  en: string;
  fr: string;
  icon: string; // lucide icon name, see app/money/icons.tsx
  /** Usually comes with a receipt (used by "Missing receipt"). */
  needsReceipt: boolean;
  /** Usually has GST/QST on it (pre-ticks "Taxes included?"). */
  taxable: boolean;
  /** Accountant export grouping. */
  accounting: "revenue" | "cogs" | "payroll" | "operating";
};

export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { id: "labour_revenue", kind: "in", en: "Labour revenue", fr: "Revenus de main-d'œuvre", icon: "wrench", needsReceipt: false, taxable: true, accounting: "revenue" },
  { id: "parts_sales", kind: "in", en: "Parts sales", fr: "Vente de pièces", icon: "package", needsReceipt: false, taxable: true, accounting: "revenue" },
  { id: "service_call_fees", kind: "in", en: "Service call / travel fees", fr: "Frais de déplacement / appel de service", icon: "truck", needsReceipt: false, taxable: true, accounting: "revenue" },
  { id: "other_income", kind: "in", en: "Other income", fr: "Autres revenus", icon: "coins", needsReceipt: false, taxable: false, accounting: "revenue" },

  { id: "parts_purchases", kind: "out", en: "Parts purchases", fr: "Achats de pièces", icon: "package", needsReceipt: true, taxable: true, accounting: "cogs" },
  { id: "technician_wages", kind: "out", en: "Technician wages & benefits", fr: "Salaires et avantages des techniciens", icon: "hard-hat", needsReceipt: false, taxable: false, accounting: "payroll" },
  { id: "owner_salary", kind: "out", en: "Owner salary", fr: "Salaire du propriétaire", icon: "user", needsReceipt: false, taxable: false, accounting: "payroll" },
  { id: "fuel", kind: "out", en: "Fuel – service trucks", fr: "Carburant – camions de service", icon: "fuel", needsReceipt: true, taxable: true, accounting: "operating" },
  { id: "shop_rent", kind: "out", en: "Shop rent / mortgage", fr: "Loyer / hypothèque de l'atelier", icon: "building", needsReceipt: false, taxable: true, accounting: "operating" },
  { id: "truck_payments", kind: "out", en: "Truck payments / leases", fr: "Paiements / location de camions", icon: "car", needsReceipt: false, taxable: true, accounting: "operating" },
  { id: "insurance", kind: "out", en: "Insurance", fr: "Assurances", icon: "shield", needsReceipt: false, taxable: false, accounting: "operating" },
  { id: "tools_equipment", kind: "out", en: "Tools & equipment", fr: "Outils et équipement", icon: "hammer", needsReceipt: true, taxable: true, accounting: "operating" },
  { id: "vehicle_maintenance", kind: "out", en: "Vehicle & equipment maintenance", fr: "Entretien des véhicules et de l'équipement", icon: "settings", needsReceipt: true, taxable: true, accounting: "operating" },
  { id: "shop_supplies", kind: "out", en: "Shop supplies & consumables", fr: "Fournitures et consommables d'atelier", icon: "spray-can", needsReceipt: true, taxable: true, accounting: "operating" },
  { id: "phone_software", kind: "out", en: "Phone, internet & software", fr: "Téléphone, internet et logiciels", icon: "smartphone", needsReceipt: true, taxable: true, accounting: "operating" },
  { id: "marketing", kind: "out", en: "Marketing & advertising", fr: "Marketing et publicité", icon: "megaphone", needsReceipt: true, taxable: true, accounting: "operating" },
  { id: "accounting_legal", kind: "out", en: "Accounting & legal", fr: "Comptabilité et frais juridiques", icon: "scale", needsReceipt: true, taxable: true, accounting: "operating" },
  { id: "utilities", kind: "out", en: "Utilities (hydro, heating)", fr: "Services publics (hydro, chauffage)", icon: "zap", needsReceipt: true, taxable: true, accounting: "operating" },
  { id: "bank_fees", kind: "out", en: "Bank fees & interest", fr: "Frais bancaires et intérêts", icon: "landmark", needsReceipt: false, taxable: false, accounting: "operating" },
  { id: "subcontracting", kind: "out", en: "Subcontracting", fr: "Sous-traitance", icon: "handshake", needsReceipt: true, taxable: true, accounting: "cogs" },
  { id: "other_expenses", kind: "out", en: "Other expenses", fr: "Autres dépenses", icon: "receipt", needsReceipt: true, taxable: true, accounting: "operating" },
];

export const PARTS_SALES_ID = "parts_sales";
export const PARTS_PURCHASES_ID = "parts_purchases";
export const TECHNICIAN_WAGES_ID = "technician_wages";

export const PAYMENT_METHODS = ["debit", "credit", "transfer", "cheque", "cash", "preauthorized", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
