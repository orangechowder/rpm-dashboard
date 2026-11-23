"use client";
import { WaveCard } from "./wave-panel";
import type { TaxMode } from "../../lib/money/tax";

import { useEffect, useState } from "react";
import { Eye, EyeOff, History, RotateCcw, Sparkles } from "lucide-react";
import { formatMoney, type Lang } from "../../lib/money/cents";
import { formatDate, monthLabel } from "../../lib/money/dates";
import { loadAudit, trashExpires, type AuditRow } from "../../lib/money/repository";
import type { MoneyCategory, MoneyEntry, MoneySettings } from "../../lib/money/types";
import { mt } from "./i18n";
import { Amount, CategoryIcon, Empty, Help, Skeleton } from "./ui";

export function SettingsTab({
  lang, settings, categories, entries, onSaveSettings, onUpdateCategory, onRestore, onOpenWizard, waveResult = null, onWaveSynced,
}: {
  lang: Lang;
  settings: MoneySettings;
  categories: MoneyCategory[];
  entries: MoneyEntry[];
  onSaveSettings: (patch: Partial<MoneySettings>) => Promise<void>;
  onUpdateCategory: (id: string, patch: Partial<MoneyCategory>) => Promise<void>;
  onRestore: (entry: MoneyEntry) => void;
  onOpenWizard: () => void;
  waveResult?: string | null;
  onWaveSynced: () => Promise<void>;
}) {
  const [gst, setGst] = useState(settings.gstNumber);
  const [qst, setQst] = useState(settings.qstNumber);
  const trash = entries.filter((e) => e.deletedAt).sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!));
  const byId = new Map(categories.map((c) => [c.id, c]));

  return (
    <div className="mn-settings">
      <WaveCard lang={lang} categories={categories} waveResult={waveResult} onSynced={onWaveSynced} />
      <section className="mn-card">
        <h3>{mt(lang, "general")}</h3>
        <div className="mn-settings-grid">
          <label className="mn-field">{mt(lang, "fiscalStart")}
            <select value={settings.fiscalYearStartMonth} onChange={(e) => void onSaveSettings({ fiscalYearStartMonth: Number(e.target.value) })}>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthLabel(i + 1, lang, true)}</option>)}
            </select>
          </label>
          <label className="mn-field">{mt(lang, "filingFrequency")}
            <select value={settings.taxFrequency} onChange={(e) => void onSaveSettings({ taxFrequency: e.target.value as MoneySettings["taxFrequency"] })}>
              <option value="monthly">{mt(lang, "freqMonthly")}</option>
              <option value="quarterly">{mt(lang, "freqQuarterly")}</option>
              <option value="yearly">{mt(lang, "freqYearly")}</option>
            </select>
          </label>
          <label className="mn-field">{mt(lang, "gstNumber")}<input value={gst} onChange={(e) => setGst(e.target.value)} onBlur={() => gst !== settings.gstNumber && void onSaveSettings({ gstNumber: gst })} placeholder="123456789 RT0001" /></label>
          <label className="mn-field">{mt(lang, "qstNumber")}<input value={qst} onChange={(e) => setQst(e.target.value)} onBlur={() => qst !== settings.qstNumber && void onSaveSettings({ qstNumber: qst })} placeholder="1234567890 TQ0001" /></label>
        </div>
        <button type="button" className="mn-ghost" onClick={onOpenWizard}><Sparkles size={15} />{mt(lang, "reopenWizard")}</button>
      </section>

      <section className="mn-card">
        <h3>{mt(lang, "categories")} <Help lang={lang} topic="taxSetting" /></h3>
        <p className="mn-muted">{mt(lang, "categoriesHelp")}</p>
        <CategoryEditor lang={lang} categories={categories} onUpdate={onUpdateCategory} />
      </section>

      <section className="mn-card" id="mn-trash">
        <h3>{mt(lang, "trash")} <Help lang={lang} topic="trash" /></h3>
        {!trash.length ? <p className="mn-muted">{mt(lang, "trashEmpty")}</p> : (
          <ul className="mn-plain-list">
            {trash.map((entry) => {
              const category = byId.get(entry.categoryId);
              return (
                <li key={entry.id} className="mn-trash-row">
                  <span className="mn-row-icon"><CategoryIcon name={category?.icon ?? "receipt"} /></span>
                  <span className="mn-row-text">
                    <b>{entry.party || (category ? (lang === "fr" ? category.fr : category.en) : "—")}</b>
                    <small>{formatDate(entry.date, lang)} · {mt(lang, "deletedOn", { date: formatDate(entry.deletedAt!.slice(0, 10), lang), who: entry.deletedBy ?? "—" })} · {lang === "fr" ? "effacé de la corbeille le" : "leaves the trash"} {formatDate(trashExpires(entry.deletedAt!), lang)}</small>
                  </span>
                  <Amount cents={entry.kind === "in" ? entry.totalCents : -entry.totalCents} lang={lang} tone={entry.kind} />
                  <button type="button" className="mn-ghost" onClick={() => onRestore(entry)}><RotateCcw size={15} />{mt(lang, "restore")}</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AuditList lang={lang} categories={categories} />
    </div>
  );
}

function CategoryEditor({ lang, categories, onUpdate }: { lang: Lang; categories: MoneyCategory[]; onUpdate: (id: string, patch: Partial<MoneyCategory>) => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  return (
    <ul className="mn-plain-list mn-cat-list">
      {categories.map((c) => (
        <li key={c.id} className={`mn-cat-row ${c.active ? "" : "mn-cat-hidden"}`}>
          <span className={`mn-row-icon mn-row-icon-${c.kind}`}><CategoryIcon name={c.icon} /></span>
          {editing === c.id ? (
            <form className="mn-cat-edit" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void onUpdate(c.id, lang === "fr" ? { fr: name } : { en: name }); setEditing(null); }}>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
              <button type="submit" className="mn-ghost">{mt(lang, "save")}</button>
            </form>
          ) : (
            <button type="button" className="mn-cat-name" onClick={() => { setEditing(c.id); setName(lang === "fr" ? c.fr : c.en); }}>
              <b>{lang === "fr" ? c.fr : c.en}</b>
              <small>{c.kind === "in" ? mt(lang, "moneyIn") : mt(lang, "moneyOut")}</small>
            </button>
          )}
          <label className="mn-cat-tax"><span className="mn-sr-only">{mt(lang, "taxSetting")}</span>
            <select value={c.taxMode} aria-label={mt(lang, "taxSetting")} onChange={(e) => void onUpdate(c.id, { taxMode: e.target.value as TaxMode })}>
              <option value="gst_qst">{mt(lang, "taxGstQst")}</option><option value="gst_only">{mt(lang, "taxGstOnly")}</option><option value="none">{mt(lang, "taxNone")}</option>
            </select>
          </label>
          <button type="button" className="mn-ghost" aria-pressed={!c.active} onClick={() => void onUpdate(c.id, { active: !c.active })}>{c.active ? <><Eye size={15} />{mt(lang, "visible")}</> : <><EyeOff size={15} />{mt(lang, "hidden")}</>}</button>
        </li>
      ))}
    </ul>
  );
}

const TABLE_NAMES: Record<string, { en: string; fr: string }> = {
  money_entries: { en: "Entry", fr: "Entrée" },
  money_categories: { en: "Category", fr: "Catégorie" },
  money_parties: { en: "Supplier/client", fr: "Fournisseur/client" },
  money_settings: { en: "Settings", fr: "Réglages" },
  money_month_locks: { en: "Month closing", fr: "Fermeture de mois" },
  money_bank_balances: { en: "Bank balance", fr: "Solde bancaire" },
  money_recurring: { en: "Repeating bill", fr: "Facture récurrente" },
  money_tax_filings: { en: "Tax filing", fr: "Remise de taxes" },
};

const FIELD_NAMES: Record<string, { en: string; fr: string }> = {
  total_cents: { en: "amount", fr: "montant" }, gst_cents: { en: "GST", fr: "TPS" }, qst_cents: { en: "QST", fr: "TVQ" },
  entry_date: { en: "date", fr: "date" }, category_id: { en: "category", fr: "catégorie" }, party_name: { en: "who", fr: "qui" },
  description: { en: "note", fr: "note" }, paid: { en: "paid", fr: "payé" }, paid_on: { en: "paid on", fr: "payé le" },
  payment_method: { en: "how paid", fr: "payé comment" }, receipt_path: { en: "receipt", fr: "reçu" }, deleted_at: { en: "trash", fr: "corbeille" },
  kind: { en: "in/out", fr: "reçu/dépensé" }, balance_cents: { en: "balance", fr: "solde" }, amount_cents: { en: "amount", fr: "montant" },
  paused: { en: "paused", fr: "en pause" }, skipped_dates: { en: "skipped dates", fr: "dates sautées" }, name: { en: "name", fr: "nom" },
  name_en: { en: "name (EN)", fr: "nom (EN)" }, name_fr: { en: "name (FR)", fr: "nom (FR)" }, active: { en: "shown", fr: "affichée" },
  tax_frequency: { en: "filing frequency", fr: "fréquence des remises" }, fiscal_year_start_month: { en: "year start", fr: "début d'année" },
  default_category_id: { en: "usual category", fr: "catégorie habituelle" }, needs_receipt: { en: "usually receipt", fr: "reçu habituel" }, tax_mode: { en: "usual taxes", fr: "taxes habituelles" }, receipt_ref: { en: "receipt reference", fr: "référence du reçu" }, taxable_default: { en: "usually taxes", fr: "taxes habituelles" },
  start_date: { en: "first date", fr: "première date" }, end_date: { en: "last date", fr: "dernière date" }, frequency: { en: "every", fr: "chaque" },
  setup_completed_at: { en: "setup done", fr: "guide terminé" }, gst_number: { en: "GST number", fr: "no TPS" }, qst_number: { en: "QST number", fr: "no TVQ" },
};
const IGNORED = new Set(["updated_at", "updated_by", "created_at", "created_by", "net_cents", "deleted_by", "name_key", "locked_at", "locked_by"]);

function show(field: string, value: unknown, lang: Lang): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.endsWith("_cents")) return formatMoney(Number(value), lang);
  if (typeof value === "boolean") return value ? (lang === "fr" ? "oui" : "yes") : (lang === "fr" ? "non" : "no");
  if (Array.isArray(value)) return value.join(", ") || "—";
  return String(value).slice(0, 60);
}

function describe(row: AuditRow, lang: Lang): string {
  if (row.action === "insert") {
    const d = row.newData ?? {};
    if (row.table === "money_entries") return `${show("total_cents", d.total_cents, lang)} · ${d.party_name || d.category_id} · ${d.entry_date}`;
    if (row.table === "money_month_locks") return lang === "fr" ? `Mois ${String(d.month).slice(0, 7)} fermé` : `Closed ${String(d.month).slice(0, 7)}`;
    return Object.entries(d).filter(([k]) => !IGNORED.has(k) && k !== "id").slice(0, 3).map(([k, v]) => `${FIELD_NAMES[k]?.[lang] ?? k}: ${show(k, v, lang)}`).join(" · ");
  }
  if (row.action === "delete") {
    const d = row.oldData ?? {};
    if (row.table === "money_month_locks") return lang === "fr" ? `Mois ${String(d.month).slice(0, 7)} rouvert` : `Reopened ${String(d.month).slice(0, 7)}`;
    return mt(lang, "removed");
  }
  const before = row.oldData ?? {};
  const after = row.newData ?? {};
  if (row.table === "money_entries" && before.deleted_at !== after.deleted_at) return after.deleted_at ? (lang === "fr" ? "Mis à la corbeille" : "Moved to trash") : (lang === "fr" ? "Restauré" : "Restored");
  const changes = Object.keys(after).filter((k) => !IGNORED.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return changes.map((k) => `${FIELD_NAMES[k]?.[lang] ?? k}: ${show(k, before[k], lang)} → ${show(k, after[k], lang)}`).join(" · ") || mt(lang, "updated");
}

function AuditList({ lang }: { lang: Lang; categories: MoneyCategory[] }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [more, setMore] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    loadAudit(100).then((r) => { if (alive) { setRows(r); setMore(r.length === 100); } }).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, []);
  const loadMore = async () => {
    if (!rows?.length) return;
    const next = await loadAudit(100, rows[rows.length - 1].id);
    setRows([...rows, ...next]);
    setMore(next.length === 100);
  };
  return (
    <section className="mn-card">
      <h3><History size={17} aria-hidden="true" /> {mt(lang, "history")}</h3>
      <p className="mn-muted">{mt(lang, "historyHelp")}</p>
      {error ? <p className="mn-problem">{mt(lang, "errorGeneric")}</p> : rows === null ? <Skeleton height={60} /> : !rows.length ? <Empty title={mt(lang, "historyEmpty")} /> : (
        <>
          <ul className="mn-plain-list mn-audit">
            {rows.map((row) => (
              <li key={row.id}>
                <span className="mn-audit-when">{new Date(row.at).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA", { dateStyle: "medium", timeStyle: "short" })}</span>
                <span className="mn-audit-who">{row.actor}</span>
                <span className="mn-audit-what"><b>{TABLE_NAMES[row.table]?.[lang] ?? row.table}</b> {row.action === "insert" ? mt(lang, "created") : ""} {describe(row, lang)}</span>
              </li>
            ))}
          </ul>
          {more && <button type="button" className="mn-ghost" onClick={() => void loadMore()}>{mt(lang, "showMore")}</button>}
        </>
      )}
    </section>
  );
}
