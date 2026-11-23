"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, Plus } from "lucide-react";
import { formatMoney, type Lang } from "../../lib/money/cents";
import { monthLabel, todayISO } from "../../lib/money/dates";
import type { RecurringRow, RuleInput } from "../../lib/money/repository";
import type { MoneyCategory, MoneySettings } from "../../lib/money/types";
import { BillSheet, frequencyText } from "./bills-tab";
import { mt } from "./i18n";
import { CategoryIcon, Sheet } from "./ui";

const L = (lang: Lang, en: string, fr: string) => (lang === "fr" ? fr : en);

const PRESETS: Array<{ en: string; fr: string; categoryId: string; taxes: boolean; frequency: RuleInput["frequency"] }> = [
  { en: "Truck payment / lease", fr: "Paiement / location de camion", categoryId: "truck_payments", taxes: true, frequency: "monthly" },
  { en: "Insurance", fr: "Assurances", categoryId: "insurance", taxes: false, frequency: "monthly" },
  { en: "Shop rent", fr: "Loyer de l'atelier", categoryId: "shop_rent", taxes: true, frequency: "monthly" },
  { en: "Phone", fr: "Téléphone", categoryId: "phone_software", taxes: true, frequency: "monthly" },
  { en: "Internet", fr: "Internet", categoryId: "phone_software", taxes: true, frequency: "monthly" },
  { en: "Software (Wave, etc.)", fr: "Logiciels (Wave, etc.)", categoryId: "phone_software", taxes: true, frequency: "monthly" },
  { en: "Hydro", fr: "Hydro", categoryId: "utilities", taxes: true, frequency: "monthly" },
  { en: "Bank fees", fr: "Frais bancaires", categoryId: "bank_fees", taxes: false, frequency: "monthly" },
];

export function SetupWizard({ lang, settings, categories, rules, onSaveSettings, onUpdateCategory, onSaveBill, onFinish, onStartImport }: {
  lang: Lang; settings: MoneySettings; categories: MoneyCategory[]; rules: RecurringRow[];
  onSaveSettings: (patch: Partial<MoneySettings>) => Promise<void>;
  onUpdateCategory: (id: string, patch: Partial<MoneyCategory>) => Promise<void>;
  onSaveBill: (rule: Partial<RuleInput>) => Promise<boolean>;
  onFinish: () => void;
  onStartImport: () => void;
}) {
  const [step, setStep] = useState(0);
  const [bill, setBill] = useState<{ preset: Partial<RuleInput>; key: number } | null>(null);
  const steps = [
    L(lang, "Your year", "Votre année"), L(lang, "Taxes", "Taxes"), L(lang, "Categories", "Catégories"), L(lang, "Bills that repeat", "Factures qui reviennent"), L(lang, "Catch up", "Rattrapage"),
  ];
  const next = () => (step < steps.length - 1 ? setStep(step + 1) : onFinish());

  return (
    <Sheet title={`${mt(lang, "setupWizard")} · ${step + 1}/${steps.length}`} onClose={onFinish} wide>
      <ol className="mn-wizard-steps">{steps.map((s, i) => <li key={s} className={i === step ? "mn-ws-on" : i < step ? "mn-ws-done" : ""}><button type="button" onClick={() => setStep(i)}>{i < step ? <Check size={13} /> : i + 1}</button><span>{s}</span></li>)}</ol>
      <div className="mn-wizard-body">
        {step === 0 && (
          <>
            <h3>{L(lang, "When does your business year start?", "Quand commence l'année de votre entreprise?")}</h3>
            <p className="mn-muted">{L(lang, "Most small businesses use January. If your accountant closes your books another month, pick it here. It sets the Year columns and “This year”.", "La plupart des petites entreprises utilisent janvier. Si votre comptable ferme vos livres un autre mois, choisissez-le ici. Ça règle les colonnes Année et « Cette année ».")}</p>
            <div className="mn-month-grid">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <button key={m} type="button" className={`mn-chip ${settings.fiscalYearStartMonth === m ? "mn-chip-on" : ""}`} onClick={() => void onSaveSettings({ fiscalYearStartMonth: m })}>{monthLabel(m, lang, true)}</button>
              ))}
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h3>{L(lang, "How often do you send GST/QST?", "À quelle fréquence remettez-vous la TPS/TVQ?")}</h3>
            <p className="mn-muted">{L(lang, "It's on your Revenu Québec notices. If you're not sure, most small shops send every 3 months.", "C'est sur vos avis de Revenu Québec. En cas de doute, la plupart des petits ateliers remettent aux 3 mois.")}</p>
            <div className="mn-choice-grid">
              {(["monthly", "quarterly", "yearly"] as const).map((f) => (
                <button key={f} type="button" className={`mn-choice ${settings.taxFrequency === f ? "mn-choice-on" : ""}`} onClick={() => void onSaveSettings({ taxFrequency: f })}>
                  <b>{mt(lang, f === "monthly" ? "freqMonthly" : f === "quarterly" ? "freqQuarterly" : "freqYearly")}</b>
                  <small>{f === "monthly" ? L(lang, "Due at the end of the next month", "À remettre à la fin du mois suivant") : f === "quarterly" ? L(lang, "Due one month after each quarter", "À remettre un mois après chaque trimestre") : L(lang, "Due 3 months after your year ends", "À remettre 3 mois après la fin de l'année")}</small>
                </button>
              ))}
            </div>
            <div className="mn-row-2">
              <label className="mn-field">{mt(lang, "gstNumber")}<input defaultValue={settings.gstNumber} onBlur={(e) => e.target.value !== settings.gstNumber && void onSaveSettings({ gstNumber: e.target.value })} placeholder="123456789 RT0001" /></label>
              <label className="mn-field">{mt(lang, "qstNumber")}<input defaultValue={settings.qstNumber} onBlur={(e) => e.target.value !== settings.qstNumber && void onSaveSettings({ qstNumber: e.target.value })} placeholder="1234567890 TQ0001" /></label>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h3>{L(lang, "Your categories", "Vos catégories")}</h3>
            <p className="mn-muted">{mt(lang, "categoriesHelp")}</p>
            <div className="mn-wizard-cats">
              {(["in", "out"] as const).map((kind) => (
                <div key={kind}>
                  <b>{kind === "in" ? mt(lang, "moneyIn") : mt(lang, "moneyOut")}</b>
                  <ul className="mn-plain-list">
                    {categories.filter((c) => c.kind === kind).map((c) => (
                      <li key={c.id} className={c.active ? "" : "mn-cat-hidden"}>
                        <CategoryIcon name={c.icon} size={15} /> <span>{lang === "fr" ? c.fr : c.en}</span>
                        <button type="button" className="mn-link" onClick={() => void onUpdateCategory(c.id, { active: !c.active })}>{c.active ? <><Eye size={13} /> {mt(lang, "visible")}</> : <><EyeOff size={13} /> {mt(lang, "hidden")}</>}</button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h3>{L(lang, "Add the bills that come back", "Ajoutez les factures qui reviennent")}</h3>
            <p className="mn-muted">{mt(lang, "noBillsHelp")}</p>
            <div className="mn-chips">
              {PRESETS.map((p) => (
                <button key={p.en} type="button" className="mn-chip" onClick={() => setBill({ key: Date.now(), preset: { name: lang === "fr" ? p.fr : p.en, categoryId: p.categoryId, taxesIncluded: p.taxes, frequency: p.frequency, kind: "out", startDate: todayISO(), autoPaid: true, paymentMethod: "preauthorized" } })}><Plus size={14} />{lang === "fr" ? p.fr : p.en}</button>
              ))}
              <button type="button" className="mn-chip" onClick={() => setBill({ key: Date.now(), preset: { kind: "out", startDate: todayISO() } })}><Plus size={14} />{L(lang, "Other", "Autre")}</button>
            </div>
            {rules.length > 0 && <ul className="mn-plain-list mn-wizard-bills">{rules.map((r) => <li key={r.id}><Check size={14} /> <b>{r.name}</b> · {formatMoney(r.amountCents, lang)} · {frequencyText(lang, r.frequency)}</li>)}</ul>}
          </>
        )}
        {step === 4 && (
          <>
            <h3>{L(lang, "Catch up this year", "Rattraper l'année")}</h3>
            <p className="mn-muted">{L(lang, "Your Wave shows your income, but most expenses were never logged. Import your Wave export and your bank statements from the start of the year: it takes a few minutes, and every month will be right.", "Votre Wave montre vos revenus, mais la plupart des dépenses n'ont jamais été inscrites. Importez votre export Wave et vos relevés bancaires depuis le début de l'année : ça prend quelques minutes, et chaque mois sera juste.")}</p>
            <button type="button" className="mn-primary mn-primary-in" onClick={onStartImport}>{L(lang, "Start importing", "Commencer l'importation")}</button>
          </>
        )}
      </div>
      <div className="mn-form-actions">
        <button type="button" className="mn-link" onClick={onFinish}>{L(lang, "Skip the guide", "Passer le guide")}</button>
        {step > 0 && <button type="button" className="mn-ghost" onClick={() => setStep(step - 1)}>{L(lang, "Back", "Retour")}</button>}
        <button type="button" className="mn-primary" onClick={next}>{step === steps.length - 1 ? L(lang, "Finish", "Terminer") : L(lang, "Next", "Suivant")}</button>
      </div>
      {bill && <BillSheet key={bill.key} lang={lang} rule={null} preset={bill.preset} categories={categories} onClose={() => setBill(null)} onSave={async (input) => { const ok = await onSaveBill(input); if (ok) setBill(null); return ok; }} />}
    </Sheet>
  );
}
