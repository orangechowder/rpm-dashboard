"use client";
// Bank / credit-card import: summary first, then the unclear lines one by one. Nothing is saved before "Save".
import { useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Check, CircleCheck, X } from "lucide-react";
import { formatMoney, type Lang } from "../../lib/money/cents";
import { formatDate } from "../../lib/money/dates";
import { summarizeTreatments, type Classified, type Reason, type Treatment } from "../../lib/money/bank-import";
import type { ParsedRow } from "../../lib/money/csv";
import type { TaxMode } from "../../lib/money/tax";
import type { MoneyCategory } from "../../lib/money/types";
import { CategoryIcon } from "./ui";

const L = (lang: Lang, en: string, fr: string) => (lang === "fr" ? fr : en);

export type BankCheck = Classified & { key: string; match: { date: string; party: string; totalCents: number; categoryId: string } | null };
export type BankItem = BankCheck & { row: ParsedRow; locked: boolean; original: Treatment; remember: boolean };
export type BankResult = { created: number; billsPaid: number; billsInClosedMonths: string[]; taxFilings: number; rulesSaved: number };

export const TREATMENT_LABEL: Record<Treatment, [string, string]> = {
  expense: ["New expense", "Nouvelle dépense"],
  bill: ["Pays a bill you logged", "Paie une facture inscrite"],
  "tax-payment": ["GST/QST sent (Taxes)", "TPS/TVQ remise (Taxes)"],
  transfer: ["Transfer / not an expense", "Virement / pas une dépense"],
  income: ["Income (comes from Wave)", "Revenu (vient de Wave)"],
  duplicate: ["Already imported", "Déjà importée"],
  review: ["To review", "À vérifier"],
  skip: ["Skipped (not saved)", "Sautée (non enregistrée)"],
};
const REASON_TEXT: Partial<Record<Reason, [string, string]>> = {
  "card-payment": ["Payment of your own credit card", "Paiement de votre propre carte de crédit"],
  "own-transfer": ["Transfer between your own accounts", "Virement entre vos propres comptes"],
  "wave-payout": ["Wave payout (income already comes from Wave)", "Versement Wave (les revenus viennent déjà de Wave)"],
  "tax-agency": ["Paid to Revenu Québec / CRA", "Payé à Revenu Québec / ARC"],
  "tax-refund": ["Money from Revenu Québec / CRA: a tax refund?", "Argent de Revenu Québec / ARC : un remboursement de taxes?"],
  rule: ["You chose this before for similar lines", "Vous l'avez choisi pour des lignes semblables"],
  remembered: ["Known supplier", "Fournisseur connu"],
  suggested: ["Looks like", "Ressemble à"],
  unknown: ["New: what is it?", "Nouveau : qu'est-ce que c'est?"],
  loan: ["Loan payment? Only the interest is an expense; the rest is not", "Paiement de prêt? Seuls les intérêts sont une dépense; le reste non"],
  owner: ["Owner draw or contribution? Not an expense", "Retrait ou apport du propriétaire? Pas une dépense"],
  "possible-duplicate": ["Looks like an entry already in Money", "Ressemble à une entrée déjà dans Argent"],
  refund: ["Money back from a supplier?", "Remboursement d'un fournisseur?"],
};
const TAX_LABEL: Record<TaxMode, [string, string]> = { gst_qst: ["GST + QST included", "TPS + TVQ incluses"], gst_only: ["GST only (no QST)", "TPS seulement (pas de TVQ)"], none: ["No tax", "Pas de taxe"] };

export function BankReview({ lang, fileName, items, setItems, categories, busy, onCancel, onSave }: {
  lang: Lang; fileName: string; items: BankItem[]; setItems: (fn: (list: BankItem[]) => BankItem[]) => void; categories: MoneyCategory[]; busy: boolean;
  onCancel: () => void; onSave: (payload: { rows: Array<Record<string, unknown>>; rules: Array<Record<string, unknown>> }) => void;
}) {
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const name = (id: string | null) => { const c = id ? byId.get(id) : null; return c ? (lang === "fr" ? c.fr : c.en) : "—"; };
  const $ = (c: number) => formatMoney(c, lang);
  const saved = (it: BankItem) => !it.locked && (it.treatment === "expense" ? Boolean(it.categoryId) : it.treatment === "bill" || it.treatment === "tax-payment");
  const summary = summarizeTreatments(items.map((it) => ({ treatment: it.treatment, totalCents: it.row.totalCents })));
  const closed = items.filter((it) => it.locked && ["expense", "bill", "tax-payment"].includes(it.treatment));
  const pending = items.findIndex((it) => it.treatment === "review");
  const toSave = items.filter(saved);

  const update = (index: number, patch: Partial<BankItem>) => setItems((list) => {
    const next = list.slice();
    next[index] = { ...next[index], ...patch };
    return next;
  });
  const decide = (index: number, treatment: Treatment, extra: Partial<BankItem> = {}) => {
    const it = items[index];
    const categoryId = extra.categoryId ?? it.categoryId;
    update(index, { treatment, remember: treatment === "transfer" || (treatment === "expense" && it.reason !== "remembered" && it.reason !== "rule"), ...extra, ...(treatment === "expense" && categoryId ? { categoryId, taxMode: extra.taxMode ?? it.taxMode } : {}) });
  };

  const save = () => {
    const rows = toSave.map((it) => ({
      date: it.row.date, kind: it.row.kind, totalCents: it.row.totalCents, description: it.row.description, party: it.party, key: it.key,
      treatment: it.treatment, categoryId: it.categoryId, taxMode: it.taxMode, billId: it.billId,
    }));
    const rules = items.filter((it) => it.remember && it.matchKey && (it.treatment === "transfer" || (it.treatment === "expense" && it.categoryId))).map((it) => ({
      matchKey: it.matchKey, kind: it.row.kind, action: it.treatment === "transfer" ? "transfer" : "category", categoryId: it.treatment === "expense" ? it.categoryId : null,
      partyName: it.party, taxMode: it.treatment === "expense" && it.categoryId && byId.get(it.categoryId)?.taxMode !== it.taxMode ? it.taxMode : null, example: it.row.description,
    }));
    onSave({ rows, rules });
  };

  const tile = (t: Treatment, tone = "") => (
    <div key={t} className={`mn-bank-tile ${tone}`}>
      <b>{summary[t].count}</b><span>{L(lang, ...TREATMENT_LABEL[t])}</span><small>{$(summary[t].cents)}</small>
    </div>
  );

  return (
    <div className="mn-bank">
      <p className="mn-muted"><b>{fileName}</b> · {items.length} {L(lang, "lines", "lignes")} · {L(lang, "nothing is saved until you press Save", "rien n'est enregistré avant « Enregistrer »")}</p>
      <div className="mn-bank-tiles">
        {tile("expense", "mn-bank-out")}{tile("bill")}{tile("tax-payment")}{tile("transfer")}{tile("income")}{tile("duplicate")}{tile("review", summary.review.count ? "mn-bank-warn" : "")}{summary.skip.count > 0 && tile("skip")}
      </div>
      {closed.length > 0 && <p className="mn-banner mn-banner-warn">{L(lang, `${closed.length} line(s) fall in a closed month: they won't be saved. Reopen the month first if they should be.`, `${closed.length} ligne(s) tombent dans un mois fermé : elles ne seront pas enregistrées. Rouvrez d'abord le mois si elles doivent l'être.`)}</p>}

      {pending >= 0 ? (
        <BankCard key={pending} lang={lang} item={items[pending]} position={`${items.filter((i) => i.treatment === "review").length} ${L(lang, "left", "restantes")}`} categories={categories.filter((c) => c.kind === items[pending].row.kind && c.active)}
          name={name} onChange={(p) => update(pending, p)} onDecide={(t, extra) => decide(pending, t, extra)} />
      ) : <p className="mn-all-good"><CircleCheck size={18} />{L(lang, "Every line is sorted.", "Toutes les lignes sont classées.")}</p>}

      <details className="mn-review-list">
        <summary>{L(lang, "See every line (change anything)", "Voir toutes les lignes (tout est modifiable)")} ({items.length})</summary>
        <ul className="mn-plain-list">
          {items.map((it, i) => (
            <li key={it.key} className={`mn-bank-row mn-bank-${it.treatment}`}>
              <span className="mn-review-date">{it.row.date}</span>
              <span className="mn-review-desc"><b>{it.party || it.row.description}</b><small>{it.row.description}{it.locked ? ` · ${L(lang, "closed month", "mois fermé")}` : ""}</small></span>
              <span className={`mn-amount ${it.row.kind === "in" ? "mn-in" : "mn-out"}`}>{$(it.row.kind === "in" ? it.row.totalCents : -it.row.totalCents)}</span>
              <select aria-label={L(lang, "What is it?", "Qu'est-ce que c'est?")} value={it.treatment} onChange={(e) => decide(i, e.target.value as Treatment)}>
                {(["expense", ...(it.original === "bill" ? ["bill"] : []), ...(it.original === "tax-payment" || it.row.kind === "out" ? ["tax-payment"] : []), "transfer", ...(it.row.kind === "in" ? ["income"] : []), ...(it.original === "duplicate" ? ["duplicate"] : []), "review", "skip"] as Treatment[])
                  .map((t) => <option key={t} value={t}>{L(lang, ...TREATMENT_LABEL[t])}</option>)}
              </select>
              {it.treatment === "expense" && (
                <>
                  <select aria-label={L(lang, "Category", "Catégorie")} value={it.categoryId ?? ""} onChange={(e) => decide(i, "expense", { categoryId: e.target.value || null, taxMode: byId.get(e.target.value)?.taxMode ?? it.taxMode })}>
                    <option value="">{L(lang, "— category —", "— catégorie —")}</option>
                    {categories.filter((c) => c.kind === it.row.kind && c.active).map((c) => <option key={c.id} value={c.id}>{lang === "fr" ? c.fr : c.en}</option>)}
                  </select>
                  <select aria-label={L(lang, "Taxes", "Taxes")} value={it.taxMode} onChange={(e) => update(i, { taxMode: e.target.value as TaxMode, remember: true })}>
                    {(Object.keys(TAX_LABEL) as TaxMode[]).map((m) => <option key={m} value={m}>{L(lang, ...TAX_LABEL[m])}</option>)}
                  </select>
                </>
              )}
            </li>
          ))}
        </ul>
      </details>

      <div className="mn-form-actions mn-inline-actions">
        <button type="button" className="mn-ghost" onClick={onCancel}><X size={15} />{L(lang, "Cancel", "Annuler")}</button>
        <button type="button" className="mn-primary" disabled={busy || !toSave.length && !items.some((it) => it.remember)} onClick={save}>
          {busy ? L(lang, "Saving…", "Enregistrement…") : L(lang,
            `Save: ${toSave.filter((i) => i.treatment === "expense").length} expenses · ${toSave.filter((i) => i.treatment === "bill").length} bills paid · ${toSave.filter((i) => i.treatment === "tax-payment").length} tax payments`,
            `Enregistrer : ${toSave.filter((i) => i.treatment === "expense").length} dépenses · ${toSave.filter((i) => i.treatment === "bill").length} factures payées · ${toSave.filter((i) => i.treatment === "tax-payment").length} remises de taxes`)}
        </button>
      </div>
      {summary.review.count > 0 && <small className="mn-muted">{L(lang, "Lines still “to review” are not saved; they'll come back next time you import this file.", "Les lignes encore « à vérifier » ne sont pas enregistrées; elles reviendront au prochain import de ce fichier.")}</small>}
    </div>
  );
}

function BankCard({ lang, item, position, categories, name, onChange, onDecide }: {
  lang: Lang; item: BankItem; position: string; categories: MoneyCategory[]; name: (id: string | null) => string;
  onChange: (p: Partial<BankItem>) => void; onDecide: (t: Treatment, extra?: Partial<BankItem>) => void;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const moved = useRef(0);
  const [picked, setPicked] = useState<string | null>(null);
  const categoryId = picked;
  const reason = REASON_TEXT[item.reason];
  const end = () => {
    if (start.current === null) return;
    start.current = null;
    if (moved.current > 110 && categoryId) onDecide("expense", { categoryId, taxMode: item.taxMode });
    else if (moved.current < -110) onDecide("transfer");
    moved.current = 0;
    setDx(0);
  };
  return (
    <div className="mn-review-card" style={{ transform: dx ? `translateX(${dx}px) rotate(${dx / 40}deg)` : undefined }}
      onPointerDown={(e) => { if (e.pointerType !== "mouse" && !(e.target as HTMLElement).closest("button,input,select")) start.current = e.clientX; }}
      onPointerMove={(e) => { if (start.current !== null) { moved.current = e.clientX - start.current; setDx(moved.current); } }}
      onPointerUp={end} onPointerCancel={end}>
      <div className="mn-review-top">
        <span className="mn-muted">{position} · {formatDate(item.row.date, lang)}</span>
        <span className={`mn-amount mn-${item.row.kind} mn-review-amount`}>{formatMoney(item.row.kind === "in" ? item.row.totalCents : -item.row.totalCents, lang)}</span>
      </div>
      <p className="mn-review-raw">{item.row.description || "—"}</p>
      {reason && <p className="mn-banner mn-banner-info">{L(lang, ...reason)}{item.reason === "suggested" && item.suggestion ? ` ${name(item.suggestion)}?` : ""}{item.match ? ` · ${item.match.party || "—"} · ${formatDate(item.match.date, lang)} · ${formatMoney(item.match.totalCents, lang)}` : ""}</p>}
      <label className="mn-field">{item.row.kind === "in" ? L(lang, "From", "De") : L(lang, "Store / supplier", "Magasin / fournisseur")}<input value={item.party} onChange={(e) => onChange({ party: e.target.value })} /></label>
      <div className="mn-tiles mn-tiles-small">
        {categories.map((c) => (
          <button key={c.id} type="button" className={`mn-tile ${categoryId === c.id ? "mn-tile-on" : ""} ${!categoryId && item.suggestion === c.id ? "mn-tile-suggested" : ""}`} aria-pressed={categoryId === c.id}
            onClick={() => { setPicked(c.id); onChange({ taxMode: c.taxMode }); }}>
            <CategoryIcon name={c.icon} size={16} /><span>{lang === "fr" ? c.fr : c.en}</span>
          </button>
        ))}
      </div>
      <label className="mn-field">{L(lang, "Taxes on this line", "Taxes sur cette ligne")}
        <select value={item.taxMode} onChange={(e) => onChange({ taxMode: e.target.value as TaxMode })}>
          {(Object.keys(TAX_LABEL) as TaxMode[]).map((m) => <option key={m} value={m}>{L(lang, ...TAX_LABEL[m])}</option>)}
        </select>
      </label>
      <div className="mn-review-actions mn-bank-actions">
        <button type="button" className="mn-ghost" onClick={() => onDecide("skip")}><X size={16} />{L(lang, "Skip", "Sauter")}</button>
        <button type="button" className="mn-ghost" onClick={() => onDecide("transfer")}><ArrowLeftRight size={16} />{L(lang, "Transfer / not an expense", "Virement / pas une dépense")}</button>
        <button type="button" className="mn-primary mn-primary-out" disabled={!categoryId} onClick={() => categoryId && onDecide("expense", { categoryId, taxMode: item.taxMode })}><Check size={16} />{item.row.kind === "in" ? L(lang, "Save it", "L'enregistrer") : L(lang, "Expense", "Dépense")}</button>
      </div>
      <small className="mn-muted mn-swipe-hint">{L(lang, "Your choice is remembered for similar lines. On a phone: swipe right = expense, left = transfer.", "Votre choix est mémorisé pour les lignes semblables. Sur téléphone : à droite = dépense, à gauche = virement.")}</small>
    </div>
  );
}
