"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Lock, Trash2 } from "lucide-react";
import { centsToInput, formatMoney, parseMoney, type Cents, type Lang } from "../../lib/money/cents";
import { PAYMENT_METHODS, type MoneyKind } from "../../lib/money/categories";
import { isISODate, monthKey, todayISO } from "../../lib/money/dates";
import { manualTaxes, noTaxes, splitTaxesIncluded, type TaxSplit } from "../../lib/money/tax";
import { type EntryInput, type Party } from "../../lib/money/repository";
import { similarity } from "../../lib/money/matching";
import type { MoneyCategory, MoneyEntry } from "../../lib/money/types";
import { mt, paymentLabel } from "./i18n";
import { CategoryIcon, Help, Sheet, Toggle } from "./ui";

export type EntryDraft = Partial<MoneyEntry> & { kind: MoneyKind };

export function EntrySheet({
  lang, draft, editing, categories, parties, clients, usage, lockedMonths, onClose, onSave, onDelete, onDuplicate,
}: {
  lang: Lang;
  draft: EntryDraft;
  editing: MoneyEntry | null;
  categories: MoneyCategory[];
  parties: Party[];
  clients: string[];
  usage: Map<string, number>;
  lockedMonths: Set<string>;
  onClose: () => void;
  onSave: (input: EntryInput, file: File | null, id: string | null, again: boolean) => Promise<boolean>;
  onDelete: (entry: MoneyEntry) => void;
  onDuplicate: (entry: MoneyEntry) => void;
}) {
  const [kind, setKind] = useState<MoneyKind>(draft.kind);
  const [amountText, setAmountText] = useState(draft.totalCents ? centsToInput(draft.totalCents, lang) : "");
  const [categoryId, setCategoryId] = useState(draft.categoryId ?? "");
  const [categoryPicked, setCategoryPicked] = useState(Boolean(draft.categoryId));
  const initialCategory = categories.find((c) => c.id === draft.categoryId);
  const [taxesIncluded, setTaxesIncluded] = useState(draft.taxesIncluded ?? initialCategory?.taxable ?? true);
  const [taxesTouched, setTaxesTouched] = useState(draft.taxesIncluded !== undefined);
  const autoSplitOfDraft = draft.totalCents !== undefined && draft.taxesIncluded ? splitTaxesIncluded(draft.totalCents) : null;
  const draftHasManualTaxes = Boolean(draft.totalCents !== undefined && (draft.gstCents || draft.qstCents) && (!autoSplitOfDraft || autoSplitOfDraft.gstCents !== draft.gstCents || autoSplitOfDraft.qstCents !== draft.qstCents));
  const [manual, setManual] = useState(draftHasManualTaxes);
  const [gstText, setGstText] = useState(draftHasManualTaxes ? centsToInput(draft.gstCents ?? 0, lang) : "");
  const [qstText, setQstText] = useState(draftHasManualTaxes ? centsToInput(draft.qstCents ?? 0, lang) : "");
  const [party, setParty] = useState(draft.party ?? "");
  const [partyOpen, setPartyOpen] = useState(false);
  const [date, setDate] = useState(draft.date ?? todayISO());
  const [paid, setPaid] = useState(draft.paid ?? true);
  const [paidOn, setPaidOn] = useState(draft.paidOn ?? "");
  const [method, setMethod] = useState<string | null>(draft.paymentMethod ?? null);
  const [note, setNote] = useState(draft.description ?? "");
  // Receipt photos are turned off: an existing photo stays attached; a short reference is typed instead.
  const receiptPath = draft.receiptPath ?? null;
  const [receiptRef, setReceiptRef] = useState(draft.receiptRef ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const locked = Boolean(editing && lockedMonths.has(monthKey(editing.date))) || lockedMonths.has(monthKey(date));
  const cents = parseMoney(amountText);

  const split: TaxSplit | null = useMemo(() => {
    if (cents === null || cents < 0) return null;
    if (manual) {
      const g = parseMoney(gstText) ?? 0;
      const q = parseMoney(qstText) ?? 0;
      return manualTaxes(cents, g, q);
    }
    return taxesIncluded ? splitTaxesIncluded(cents) : noTaxes(cents);
  }, [cents, manual, gstText, qstText, taxesIncluded]);

  const tiles = useMemo(() => categories
    .filter((c) => c.kind === kind && (c.active || c.id === categoryId))
    .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.sortOrder - b.sortOrder), [categories, kind, categoryId, usage]);

  const names = useMemo(() => {
    const fromParties = parties.filter((p) => (kind === "in" ? p.kind !== "supplier" : p.kind !== "client")).map((p) => p.name);
    const list = kind === "in" ? [...fromParties, ...clients] : fromParties;
    const seen = new Set<string>();
    return list.filter((name) => { const key = name.trim().toLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true; });
  }, [parties, clients, kind]);

  const suggestions = useMemo(() => {
    const q = party.trim().toLowerCase();
    if (!q) return names.slice(0, 6);
    return names.filter((n) => n.toLowerCase().includes(q) && n.toLowerCase() !== q).sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q))).slice(0, 6);
  }, [names, party]);

  const pickCategory = (id: string, byPerson: boolean) => {
    setCategoryId(id);
    if (byPerson) setCategoryPicked(true);
    const category = categories.find((c) => c.id === id);
    if (category && !taxesTouched && !manual) setTaxesIncluded(category.taxable);
  };

  const pickParty = (name: string) => {
    setParty(name);
    setPartyOpen(false);
    if (categoryPicked) return;
    const remembered = parties.find((p) => p.categoryId && similarity(p.name, name) >= 0.99 && p.name.trim().toLowerCase() === name.trim().toLowerCase());
    const category = remembered && categories.find((c) => c.id === remembered.categoryId && c.kind === kind && c.active);
    if (category) pickCategory(category.id, false);
  };

  const switchKind = (next: MoneyKind) => {
    if (next === kind) return;
    setKind(next);
    setCategoryId("");
    setCategoryPicked(false);
    setTaxesTouched(false);
  };

  const submit = async (again: boolean) => {
    setProblem(null);
    if (cents === null || cents <= 0) { setProblem(cents === null && !amountText.trim() ? mt(lang, "enterAmount") : mt(lang, "amountProblem")); amountRef.current?.focus(); return; }
    if (!split) { setProblem(mt(lang, "taxProblem")); return; }
    if (!categoryId) { setProblem(mt(lang, "pickCategory")); return; }
    if (!isISODate(date)) { setProblem(mt(lang, "amountProblem")); return; }
    const input: EntryInput = {
      kind, date, categoryId, party, description: note,
      totalCents: split.totalCents, gstCents: split.gstCents, qstCents: split.qstCents,
      taxesIncluded: manual ? true : taxesIncluded,
      paymentMethod: method, paid, paidOn: paid ? (isISODate(paidOn) ? paidOn : date) : null,
      receiptPath,
      receiptRef,
    };
    setBusy(true);
    const ok = await onSave(input, null, editing?.id ?? null, again);
    setBusy(false);
    if (ok && again) {
      setAmountText(""); setParty(""); setNote(""); setReceiptRef(""); setManual(false); setGstText(""); setQstText("");
      setCategoryId(""); setCategoryPicked(false); setTaxesTouched(false);
      amountRef.current?.focus();
    }
  };



  const title = editing ? mt(lang, "edit") : kind === "in" ? mt(lang, "moneyIn") : mt(lang, "moneyOut");
  const showTaxLine = split && split.totalCents > 0;

  return (
    <Sheet title={title} onClose={onClose} tone={kind}>
      <form className="mn-form" onSubmit={(event) => { event.preventDefault(); void submit(false); }}>
        {locked && <p className="mn-banner mn-banner-warn"><Lock size={15} aria-hidden="true" />{mt(lang, "lockedMonth")}</p>}
        <div className="mn-kind-switch" role="radiogroup" aria-label={mt(lang, "money")}>
          <button type="button" role="radio" aria-checked={kind === "in"} className={kind === "in" ? "mn-kind-in-on" : ""} onClick={() => switchKind("in")}>{mt(lang, "moneyIn")}</button>
          <button type="button" role="radio" aria-checked={kind === "out"} className={kind === "out" ? "mn-kind-out-on" : ""} onClick={() => switchKind("out")}>{mt(lang, "moneyOut")}</button>
        </div>

        <label className="mn-amount-field">
          <span className="sr-only">{mt(lang, "amount")}</span>
          <span className="mn-amount-currency" aria-hidden="true">$</span>
          <input
            ref={amountRef}
            data-autofocus
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="next"
            placeholder="0.00"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value.replace(/[^0-9.,\s]/g, ""))}
            aria-invalid={Boolean(amountText && (cents === null || cents <= 0))}
          />
        </label>

        <div className="mn-tax-box">
          <Toggle
            checked={taxesIncluded || manual}
            onChange={(value) => { setTaxesIncluded(value); setTaxesTouched(true); if (!value) setManual(false); }}
            label={mt(lang, "taxesIncluded")}
            help={<Help lang={lang} topic="taxesIncluded" />}
          />
          {showTaxLine && (taxesIncluded || manual) && (
            <p className="mn-tax-line">
              {mt(lang, "beforeTaxes")} <b>{formatMoney(split.netCents, lang)}</b> · {mt(lang, "gst")} <b>{formatMoney(split.gstCents, lang)}</b> · {mt(lang, "qst")} <b>{formatMoney(split.qstCents, lang)}</b>
            </p>
          )}
          {(taxesIncluded || manual) && cents !== null && cents > 0 && (
            manual ? (
              <div className="mn-manual-taxes">
                <label>{mt(lang, "gst")}<input inputMode="decimal" value={gstText} onChange={(e) => setGstText(e.target.value)} /></label>
                <label>{mt(lang, "qst")}<input inputMode="decimal" value={qstText} onChange={(e) => setQstText(e.target.value)} /></label>
              </div>
            ) : (
              <button type="button" className="mn-link" onClick={() => { const s = splitTaxesIncluded(cents); setManual(true); setGstText(centsToInput(s.gstCents, lang)); setQstText(centsToInput(s.qstCents, lang)); }}>{mt(lang, "editTaxes")}</button>
            )
          )}
        </div>

        <fieldset className="mn-field">
          <legend>{mt(lang, "category")}</legend>
          <div className="mn-tiles">
            {tiles.map((c) => (
              <button key={c.id} type="button" className={`mn-tile ${categoryId === c.id ? "mn-tile-on" : ""}`} aria-pressed={categoryId === c.id} onClick={() => pickCategory(c.id, true)}>
                <CategoryIcon name={c.icon} size={20} />
                <span>{lang === "fr" ? c.fr : c.en}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mn-field mn-party">
          <label htmlFor="mn-party">{kind === "in" ? mt(lang, "whoClient") : mt(lang, "whoSupplier")}</label>
          <input
            id="mn-party"
            value={party}
            autoComplete="off"
            onFocus={() => setPartyOpen(true)}
            onBlur={() => window.setTimeout(() => setPartyOpen(false), 150)}
            onChange={(event) => { setParty(event.target.value); setPartyOpen(true); }}
            onKeyDown={(event) => { if (event.key === "Enter" && partyOpen && suggestions[0] && party.trim()) { event.preventDefault(); pickParty(suggestions[0]); } }}
            role="combobox"
            aria-expanded={partyOpen && suggestions.length > 0}
            aria-controls="mn-party-list"
            aria-autocomplete="list"
          />
          {partyOpen && suggestions.length > 0 && (
            <ul id="mn-party-list" role="listbox" className="mn-suggest">
              {suggestions.map((name) => (
                <li key={name} role="option" aria-selected={false} onMouseDown={(event) => { event.preventDefault(); pickParty(name); }}>{name}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="mn-row-2">
          <label className="mn-field">{mt(lang, "date")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <div className="mn-field">
            <span className="mn-field-label">{mt(lang, "paidAlready")} <Help lang={lang} topic="paid" /></span>
            <div className="mn-seg">
              <button type="button" aria-pressed={paid} className={paid ? "mn-seg-on" : ""} onClick={() => setPaid(true)}>{mt(lang, "paidYes")}</button>
              <button type="button" aria-pressed={!paid} className={!paid ? "mn-seg-on mn-seg-warn" : ""} onClick={() => setPaid(false)}>{mt(lang, "paidNo")}</button>
            </div>
          </div>
        </div>
        {paid && editing && (
          <label className="mn-field mn-field-narrow">{mt(lang, "paidOn")}<input type="date" value={paidOn || date} onChange={(e) => setPaidOn(e.target.value)} /></label>
        )}

        <fieldset className="mn-field">
          <legend>{mt(lang, "howPaid")}</legend>
          <div className="mn-chips mn-chips-scroll">
            {PAYMENT_METHODS.map((m) => (
              <button key={m} type="button" className={`mn-chip ${method === m ? "mn-chip-on" : ""}`} aria-pressed={method === m} onClick={() => setMethod(method === m ? null : m)}>{paymentLabel(lang, m)}</button>
            ))}
          </div>
        </fieldset>

        <label className="mn-field">{mt(lang, "receiptRef")} <Help lang={lang} topic="receiptRef" />
          <input value={receiptRef} maxLength={120} placeholder={mt(lang, "receiptRefExample")} onChange={(e) => setReceiptRef(e.target.value)} />
        </label>

        <label className="mn-field">{mt(lang, "note")}<input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>

        {problem && <p className="mn-problem" role="alert">{problem}</p>}

        <div className="mn-form-actions">
          {editing && (
            <div className="mn-form-secondary">
              <button type="button" className="mn-ghost mn-danger-text" disabled={locked || busy} onClick={() => onDelete(editing)}><Trash2 size={15} />{mt(lang, "delete")}</button>
              <button type="button" className="mn-ghost" disabled={busy} onClick={() => onDuplicate(editing)}><Copy size={15} />{mt(lang, "duplicate")}</button>
            </div>
          )}
          {!editing && <button type="button" className="mn-ghost" disabled={busy || locked} onClick={() => void submit(true)}>{mt(lang, "saveAndNew")}</button>}
          <button type="submit" className={`mn-primary mn-primary-${kind}`} disabled={busy || locked}>{busy ? mt(lang, "saving") : mt(lang, "save")}</button>
        </div>
      </form>
    </Sheet>
  );
}

export function totalPreview(cents: Cents | null, lang: Lang) {
  return cents === null ? "" : formatMoney(cents, lang);
}
