"use client";

import { useMemo, useState } from "react";
import { Pause, Pencil, Play, Repeat, SkipForward, Trash2 } from "lucide-react";
import { centsToInput, formatMoney, parseMoney, type Lang } from "../../lib/money/cents";
import { PAYMENT_METHODS, type MoneyKind } from "../../lib/money/categories";
import { formatDate, isISODate, todayISO, type ISODate } from "../../lib/money/dates";
import { FREQUENCIES, monthlyEquivalentCents, nextOccurrence, type Frequency } from "../../lib/money/recurring";
import type { RecurringRow, RuleInput } from "../../lib/money/repository";
import type { MoneyCategory } from "../../lib/money/types";
import { mt, paymentLabel, type MoneyKey } from "./i18n";
import { CategoryIcon, Empty, Help, Sheet, Toggle } from "./ui";

const FREQ_LABEL: Record<Frequency, MoneyKey> = { weekly: "weekly", biweekly: "biweekly", monthly: "monthlyFreq", quarterly: "quarterlyFreq", yearly: "yearly" };

export function frequencyText(lang: Lang, frequency: Frequency) {
  return `${mt(lang, "every")} ${mt(lang, FREQ_LABEL[frequency])}`;
}

export function BillsTab({
  lang, rules, categories, onSave, onPause, onSkip, onDelete,
}: {
  lang: Lang;
  rules: RecurringRow[];
  categories: MoneyCategory[];
  onSave: (rule: Partial<RuleInput>, id?: string) => Promise<boolean>;
  onPause: (rule: RecurringRow, paused: boolean) => void;
  onSkip: (rule: RecurringRow, date: ISODate) => void;
  onDelete: (rule: RecurringRow) => void;
}) {
  const [editing, setEditing] = useState<{ rule: RecurringRow | null; key: number } | null>(null);
  const today = todayISO();
  const byId = new Map(categories.map((c) => [c.id, c]));
  const sorted = useMemo(() => [...rules].sort((a, b) => (nextOccurrence(a, today) ?? "9999").localeCompare(nextOccurrence(b, today) ?? "9999")), [rules, today]);
  const monthly = rules.filter((r) => !r.paused && r.kind === "out" && (!r.endDate || r.endDate >= today)).reduce((s, r) => s + monthlyEquivalentCents(r), 0);

  return (
    <section className="mn-bills">
      <div className="mn-section-head">
        <div>
          <h2>{mt(lang, "bills")} <Help lang={lang} topic="bills" /></h2>
          {rules.length > 0 && <p className="mn-muted">{mt(lang, "perMonth", { amount: formatMoney(monthly, lang) })}</p>}
        </div>
        <button type="button" className="mn-primary mn-primary-out" onClick={() => setEditing({ rule: null, key: Date.now() })}>{mt(lang, "addBill")}</button>
      </div>
      {!rules.length ? (
        <Empty title={mt(lang, "noBills")} text={mt(lang, "noBillsHelp")}>
          <button type="button" className="mn-ghost" onClick={() => setEditing({ rule: null, key: Date.now() })}>{mt(lang, "addBill")}</button>
        </Empty>
      ) : (
        <ul className="mn-plain-list mn-bill-list">
          {sorted.map((rule) => {
            const category = byId.get(rule.categoryId);
            const next = nextOccurrence(rule, today);
            const ended = !rule.paused && !next;
            return (
              <li key={rule.id} className={`mn-bill ${rule.paused || ended ? "mn-bill-off" : ""}`}>
                <span className={`mn-row-icon mn-row-icon-${rule.kind}`}><CategoryIcon name={category?.icon ?? "receipt"} /></span>
                <span className="mn-bill-text">
                  <b>{rule.name}</b>
                  <small>{[rule.party, category ? (lang === "fr" ? category.fr : category.en) : ""].filter(Boolean).join(" · ")}</small>
                  <small><Repeat size={12} aria-hidden="true" /> {frequencyText(lang, rule.frequency)} · {rule.paused ? mt(lang, "paused") : ended ? mt(lang, "ended") : `${mt(lang, "nextDate")}${lang === "fr" ? " : " : ": "}${formatDate(next!, lang)}`}</small>
                </span>
                <span className={`mn-amount mn-${rule.kind} mn-bill-amount`}>{formatMoney(rule.kind === "out" ? -rule.amountCents : rule.amountCents, lang)}</span>
                <span className="mn-bill-actions">
                  <button type="button" className="mn-ghost" onClick={() => setEditing({ rule, key: Date.now() })}><Pencil size={14} />{mt(lang, "edit")}</button>
                  <button type="button" className="mn-ghost" onClick={() => onPause(rule, !rule.paused)}>{rule.paused ? <><Play size={14} />{mt(lang, "resume")}</> : <><Pause size={14} />{mt(lang, "pause")}</>}</button>
                  {next && !rule.paused && <button type="button" className="mn-ghost" onClick={() => onSkip(rule, next)} title={formatDate(next, lang)}><SkipForward size={14} />{mt(lang, "skipNext")}</button>}
                  <button type="button" className="mn-ghost mn-danger-text" aria-label={mt(lang, "delete")} onClick={() => onDelete(rule)}><Trash2 size={14} /></button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <BillSheet key={editing.key} lang={lang} rule={editing.rule} categories={categories} onClose={() => setEditing(null)} onSave={async (input) => { const ok = await onSave(input, editing.rule?.id); if (ok) setEditing(null); return ok; }} />}
    </section>
  );
}

export function BillSheet({ lang, rule, categories, onClose, onSave, preset }: { lang: Lang; rule: RecurringRow | null; categories: MoneyCategory[]; onClose: () => void; onSave: (input: Partial<RuleInput>) => Promise<boolean>; preset?: Partial<RuleInput> }) {
  const base = rule ?? preset ?? {};
  const [name, setName] = useState(base.name ?? "");
  const [kind, setKind] = useState<MoneyKind>(base.kind ?? "out");
  const [amountText, setAmountText] = useState(base.amountCents ? centsToInput(base.amountCents, lang) : "");
  const [taxes, setTaxes] = useState(base.taxesIncluded ?? true);
  const [categoryId, setCategoryId] = useState(base.categoryId ?? "");
  const [party, setParty] = useState(base.party ?? "");
  const [frequency, setFrequency] = useState<Frequency>(base.frequency ?? "monthly");
  const [startDate, setStartDate] = useState(base.startDate ?? todayISO());
  const [endDate, setEndDate] = useState(base.endDate ?? "");
  const [autoPaid, setAutoPaid] = useState(base.autoPaid ?? true);
  const [method, setMethod] = useState<string | null>(base.paymentMethod ?? "preauthorized");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cents = parseMoney(amountText);

  const submit = async () => {
    setProblem(null);
    if (!name.trim()) { setProblem(lang === "fr" ? "Donnez un nom à la facture." : "Give the bill a name."); return; }
    if (cents === null || cents <= 0) { setProblem(mt(lang, "amountProblem")); return; }
    if (!categoryId) { setProblem(mt(lang, "pickCategory")); return; }
    if (!isISODate(startDate) || (endDate && (!isISODate(endDate) || endDate < startDate))) { setProblem(lang === "fr" ? "Vérifiez les dates." : "Check the dates."); return; }
    setBusy(true);
    const ok = await onSave({ name: name.trim(), kind, amountCents: cents, taxesIncluded: taxes, categoryId, party: party.trim(), frequency, startDate, endDate: endDate || null, autoPaid, paymentMethod: method });
    setBusy(false);
    if (!ok) setProblem(mt(lang, "errorGeneric"));
  };

  return (
    <Sheet title={rule ? `${mt(lang, "edit")} · ${rule.name}` : mt(lang, "addBill").replace(/^\+\s*/, "")} onClose={onClose} tone={kind}>
      <form className="mn-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="mn-field">{mt(lang, "billName")}<input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={lang === "fr" ? "ex. Paiement camion F-550" : "e.g. F-550 truck payment"} data-autofocus /></label>
        <div className="mn-kind-switch" role="radiogroup" aria-label={mt(lang, "money")}>
          <button type="button" role="radio" aria-checked={kind === "in"} className={kind === "in" ? "mn-kind-in-on" : ""} onClick={() => { setKind("in"); setCategoryId(""); }}>{mt(lang, "moneyIn")}</button>
          <button type="button" role="radio" aria-checked={kind === "out"} className={kind === "out" ? "mn-kind-out-on" : ""} onClick={() => { setKind("out"); setCategoryId(""); }}>{mt(lang, "moneyOut")}</button>
        </div>
        <div className="mn-row-2">
          <label className="mn-field">{mt(lang, "amount")}<input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.00" /></label>
          <label className="mn-field">{mt(lang, "every")}
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {FREQUENCIES.map((f) => <option key={f} value={f}>{mt(lang, FREQ_LABEL[f])}</option>)}
            </select>
          </label>
        </div>
        <div className="mn-tax-box"><Toggle checked={taxes} onChange={setTaxes} label={mt(lang, "taxesIncluded")} help={<Help lang={lang} topic="taxesIncluded" />} /></div>
        <fieldset className="mn-field">
          <legend>{mt(lang, "category")}</legend>
          <div className="mn-tiles">
            {categories.filter((c) => c.kind === kind && (c.active || c.id === categoryId)).map((c) => (
              <button key={c.id} type="button" className={`mn-tile ${categoryId === c.id ? "mn-tile-on" : ""}`} aria-pressed={categoryId === c.id} onClick={() => { setCategoryId(c.id); if (!rule) setTaxes(c.taxable); }}>
                <CategoryIcon name={c.icon} size={20} /><span>{lang === "fr" ? c.fr : c.en}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <label className="mn-field">{kind === "in" ? mt(lang, "whoClient") : mt(lang, "whoSupplier")}<input value={party} maxLength={120} onChange={(e) => setParty(e.target.value)} /></label>
        <div className="mn-row-2">
          <label className="mn-field">{mt(lang, "firstDate")}<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label className="mn-field">{mt(lang, "endDate")}<input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} /></label>
        </div>
        <Toggle checked={autoPaid} onChange={setAutoPaid} label={mt(lang, "autoPaid")} />
        <fieldset className="mn-field">
          <legend>{mt(lang, "howPaid")}</legend>
          <div className="mn-chips mn-chips-scroll">
            {PAYMENT_METHODS.map((m) => <button key={m} type="button" className={`mn-chip ${method === m ? "mn-chip-on" : ""}`} aria-pressed={method === m} onClick={() => setMethod(method === m ? null : m)}>{paymentLabel(lang, m)}</button>)}
          </div>
        </fieldset>
        {rule && <p className="mn-muted">{lang === "fr" ? "Les changements s'appliquent aux prochaines dates. Ce qui est déjà inscrit ne change pas." : "Changes apply to the next dates. What's already logged stays as it is."}</p>}
        {problem && <p className="mn-problem" role="alert">{problem}</p>}
        <div className="mn-form-actions">
          <button type="submit" className={`mn-primary mn-primary-${kind}`} disabled={busy}>{busy ? mt(lang, "saving") : mt(lang, "save")}</button>
        </div>
      </form>
    </Sheet>
  );
}
