"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import "./money.css";
import type { Lang } from "../../lib/money/cents";
import { addDays, todayISO } from "../../lib/money/dates";
import {
  MoneyError, closeMonth, createEntries, createEntry, loadBankBalances, loadCategories, loadEntries, loadLocks, loadParties, loadRules, loadSettings,
  occurrencesByRule, rememberParty, reopenMonth, restoreEntry, saveBankBalance, saveRule, saveSettings, trashEntry, trashRule, updateCategory, updateEntry,
  uploadReceipt, type EntryInput, type Party, type RecurringRow, type RuleInput,
} from "../../lib/money/repository";
import { datesToSkipOnResume, pendingOccurrences } from "../../lib/money/recurring";
import { noTaxes, splitTaxesIncluded } from "../../lib/money/tax";
import { monthTitle } from "../../lib/money/insights";
import type { Cents } from "../../lib/money/cents";
import { formatDate, type ISODate } from "../../lib/money/dates";
import { BillsTab } from "./bills-tab";
import { StatementTab } from "./statement-tab";
import { KeepAsideCard, TaxesTab, TaxReminderBanner, taxReminders, type Filings } from "./taxes-tab";
import { ImportTab } from "./import-tab";
import { SetupWizard } from "./wizard";
import { loadFilings, markFiled, unmarkFiled } from "../../lib/money/repository";
import type { TaxPeriod } from "../../lib/money/periods";
import { DEFAULT_SETTINGS, type MoneyCategory, type MoneyEntry, type MoneySettings } from "../../lib/money/types";
import { EntrySheet, type EntryDraft } from "./entry-sheet";
import { mt, type MoneyKey } from "./i18n";
import { LogTab, type Filter } from "./log-tab";
import { initialPeriod, OverviewTab, type GoTarget, type PeriodState } from "./overview-tab";
import { loadWaveAttention, resolveWave, type WaveAttention } from "./wave-panel";
import { supabase } from "../../lib/supabase";
import { SettingsTab } from "./settings-tab";
import { ToastHost, type Toast } from "./ui";

export type MoneyTab = "overview" | "log" | "monthly" | "quarterly" | "bills" | "taxes" | "import" | "settings";
const TABS: Array<{ id: MoneyTab; label: MoneyKey }> = [
  { id: "overview", label: "tabOverview" },
  { id: "log", label: "tabLog" },
  { id: "monthly", label: "tabMonthly" },
  { id: "quarterly", label: "tabQuarterly" },
  { id: "bills", label: "tabBills" },
  { id: "taxes", label: "tabTaxes" },
  { id: "import", label: "tabImport" },
  { id: "settings", label: "tabSettings" },
];

export default function MoneyApp({ language, clients }: { language: Lang; clients: string[] }) {
  const lang = language;
  const [tab, setTab] = useState<MoneyTab>(() => (new URLSearchParams(window.location.search).get("money") === "settings" ? "settings" : "overview"));
  const [waveResult] = useState(() => { const q = new URLSearchParams(window.location.search); const r = q.get("wave"); return r && q.get("detail") ? `${r}: ${q.get("detail")}` : r; });
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).get("money")) return;
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const [period, setPeriod] = useState<PeriodState>(initialPeriod);
  const [focusMonth, setFocusMonth] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entries, setEntries] = useState<MoneyEntry[]>([]);
  const [categories, setCategories] = useState<MoneyCategory[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [settings, setSettings] = useState<MoneySettings>(DEFAULT_SETTINGS);
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const [rules, setRules] = useState<RecurringRow[]>([]);
  const [balances, setBalances] = useState<Map<string, Cents>>(new Map());
  const [filings, setFilings] = useState<Filings>(new Map());
  const [wizard, setWizard] = useState(false);
  const [waveItems, setWaveItems] = useState<WaveAttention[]>([]);
  const [sheet, setSheet] = useState<{ draft: EntryDraft; editing: MoneyEntry | null; key: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, options: Omit<Toast, "id" | "text"> = {}) => {
    const id = ++toastId.current;
    setToasts((list) => [...list.slice(-2), { id, text, ...options }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), options.action ? 8000 : 3500);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const failMessage = useCallback((error: unknown) => {
    if (error instanceof MoneyError) {
      if (error.code === "locked") return mt(lang, "lockedMonth");
      if (error.code === "offline") return mt(lang, "errorOffline");
      if (error.code === "forbidden") return mt(lang, "adminsOnly");
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) return mt(lang, "errorOffline");
    return mt(lang, "errorGeneric");
  }, [lang]);

  /** Logs every repeating bill that's due and missing (catch-up), never twice. Returns the new entries. */
  const runBills = useCallback(async (ruleList: RecurringRow[], current: MoneyEntry[], lockSet: Set<string>) => {
    const today = todayISO();
    const existing = occurrencesByRule(current);
    const inputs: EntryInput[] = [];
    for (const rule of ruleList) {
      for (const date of pendingOccurrences(rule, existing.get(rule.id) ?? [], today, lockSet)) {
        const split = rule.taxesIncluded ? splitTaxesIncluded(rule.amountCents) : noTaxes(rule.amountCents);
        inputs.push({
          kind: rule.kind, date, categoryId: rule.categoryId, party: rule.party, description: rule.name,
          totalCents: split.totalCents, gstCents: split.gstCents, qstCents: split.qstCents, taxesIncluded: rule.taxesIncluded,
          paymentMethod: rule.paymentMethod, paid: rule.autoPaid, paidOn: rule.autoPaid ? date : null, receiptPath: null,
          recurringId: rule.id, occurrenceDate: date, source: "recurring",
        });
      }
    }
    if (!inputs.length) return [];
    return createEntries(inputs, "recurring_id,occurrence_date");
  }, []);

  const langRef = useRef(lang);
  const failMessageRef = useRef(failMessage);
  useEffect(() => { langRef.current = lang; failMessageRef.current = failMessage; }, [lang, failMessage]);

  const reload = useCallback(async () => {
    try {
      const [e, c, p, s, l, r, b, f] = await Promise.all([loadEntries(), loadCategories(), loadParties(), loadSettings(), loadLocks(), loadRules(), loadBankBalances(), loadFilings()]);
      setCategories(c); setParties(p); setSettings(s); setLocks(l); setRules(r); setBalances(b); setFilings(f);
      if (!s.setupCompletedAt) setWizard(true);
      let all = e;
      try {
        const created = await runBills(r, e, l);
        if (created.length) {
          all = [...created, ...e];
          toast(mt(langRef.current, "billsCreated", { count: created.length }));
        }
      } catch {
        // Bills will be retried next time; the rest of Money still works.
      }
      setEntries(all);
      setLoadError(null);
      // Wave sync lines for "Needs attention" (never blocks the rest of Money).
      loadWaveAttention().then(setWaveItems).catch(() => setWaveItems([]));
    } catch (error) {
      setLoadError(failMessageRef.current(error));
    } finally {
      setLoading(false);
    }
  }, [runBills, toast]);

  useEffect(() => {
    // Load once when the section opens; reload() only sets state after its awaits resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const usage = useMemo(() => {
    const since = addDays(todayISO(), -90);
    const map = new Map<string, number>();
    for (const e of entries) if (!e.deletedAt && e.date >= since) map.set(e.categoryId, (map.get(e.categoryId) ?? 0) + 1);
    return map;
  }, [entries]);

  const upsertLocal = (entry: MoneyEntry) => setEntries((list) => {
    const index = list.findIndex((e) => e.id === entry.id);
    if (index === -1) return [entry, ...list];
    const next = list.slice();
    next[index] = entry;
    return next;
  });

  const openNew = (kind: "in" | "out") => setSheet({ draft: { kind }, editing: null, key: Date.now() });
  const openEdit = (entry: MoneyEntry) => setSheet({ draft: { ...entry }, editing: entry, key: Date.now() });
  const duplicate = (entry: MoneyEntry) => setSheet({
    draft: { kind: entry.kind, totalCents: entry.totalCents, gstCents: entry.gstCents, qstCents: entry.qstCents, taxesIncluded: entry.taxesIncluded, categoryId: entry.categoryId, party: entry.party, description: entry.description, paymentMethod: entry.paymentMethod, paid: true, date: todayISO() },
    editing: null, key: Date.now(),
  });
  const lastEntry = useMemo(() => entries.filter((e) => !e.deletedAt && e.source === "manual").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null, [entries]);

  const saveEntry = async (input: EntryInput, file: File | null, id: string | null, again: boolean) => {
    try {
      const receiptPath = file ? await uploadReceipt(file, input.date) : input.receiptPath;
      const saved = id ? await updateEntry(id, { ...input, receiptPath }) : await createEntry({ ...input, receiptPath, source: "manual" });
      upsertLocal(saved);
      if (input.party.trim()) {
        void rememberParty(input.party, input.kind === "in" ? "client" : "supplier", input.categoryId, parties).then((party) => {
          if (party) setParties((list) => [...list.filter((p) => p.id !== party.id), party].sort((a, b) => a.name.localeCompare(b.name)));
        }).catch(() => undefined);
      }
      toast(mt(lang, "saved"));
      if (!again) setSheet(null);
      return true;
    } catch (error) {
      toast(failMessage(error), { tone: "error" });
      return false;
    }
  };

  const deleteEntry = async (entry: MoneyEntry) => {
    try {
      const trashed = await trashEntry(entry.id);
      upsertLocal(trashed);
      setSheet(null);
      toast(mt(lang, "movedToTrash"), { action: { label: mt(lang, "undo"), run: () => void restore(trashed, true) } });
    } catch (error) {
      toast(failMessage(error), { tone: "error" });
    }
  };

  const restore = async (entry: MoneyEntry, quiet = false) => {
    try {
      upsertLocal(await restoreEntry(entry.id));
      if (!quiet) toast(mt(lang, "restored"));
    } catch (error) {
      toast(failMessage(error), { tone: "error" });
    }
  };

  const markPaid = async (entry: MoneyEntry) => {
    try {
      upsertLocal(await updateEntry(entry.id, { paid: true, paidOn: todayISO() }));
      toast(mt(lang, "saved"));
    } catch (error) {
      toast(failMessage(error), { tone: "error" });
    }
  };

  const [logFilter, setLogFilter] = useState<{ value: Filter; key: number }>({ value: "all", key: 0 });
  const goTo = (next: GoTarget, month?: string) => {
    if (month) setFocusMonth(month);
    if (next === "log-receipts") { setLogFilter({ value: "all", key: Date.now() }); setTab("log"); return; }
    setTab(next);
  };

  const waveAction = async (item: WaveAttention, action: "add" | "ignore") => {
    try {
      await resolveWave(item.ref, action === "add" ? "added" : "ignored");
      setWaveItems((list) => list.filter((i) => i.ref !== item.ref));
      if (action === "add") {
        await fetch("/api/money/wave/sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await supabase!.auth.getSession()).data.session?.access_token ?? ""}` }, body: JSON.stringify({ mode: "sync" }) });
        await reload();
      }
    } catch (error) {
      toast(failMessage(error));
    }
  };

  const saveBill = async (input: Partial<RuleInput>, id?: string) => {
    try {
      const saved = await saveRule(input, id);
      const nextRules = [...rules.filter((r) => r.id !== saved.id), saved];
      setRules(nextRules);
      const created = await runBills([saved], entries, locks);
      if (created.length) { setEntries((list) => [...created, ...list]); toast(mt(lang, "billsCreated", { count: created.length })); }
      else toast(mt(lang, "saved"));
      return true;
    } catch (error) {
      toast(failMessage(error), { tone: "error" });
      return false;
    }
  };

  const pauseBill = async (rule: RecurringRow, paused: boolean) => {
    const today = todayISO();
    const patch: Partial<RuleInput> = paused
      ? { paused: true, pausedOn: today }
      : { paused: false, pausedOn: null, skippedDates: [...new Set([...rule.skippedDates, ...datesToSkipOnResume(rule, rule.pausedOn ?? today, today)])] };
    await saveBill(patch, rule.id);
  };

  const skipBill = async (rule: RecurringRow, date: ISODate) => {
    if (await saveBill({ skippedDates: [...new Set([...rule.skippedDates, date])] }, rule.id)) toast(mt(lang, "skipped", { date: formatDate(date, lang) }));
  };

  const deleteBill = async (rule: RecurringRow) => {
    if (!window.confirm(lang === "fr" ? `Supprimer « ${rule.name} »? Ce qui est déjà inscrit reste.` : `Delete “${rule.name}”? What's already logged stays.`)) return;
    try {
      await trashRule(rule.id);
      setRules((list) => list.filter((r) => r.id !== rule.id));
      toast(mt(lang, "movedToTrash"));
    } catch (error) {
      toast(failMessage(error), { tone: "error" });
    }
  };

  const toggleMonth = async (month: string, close: boolean) => {
    const label = monthTitle(month, lang);
    if (!window.confirm(mt(lang, close ? "closeMonthConfirm" : "reopenMonthConfirm", { month: label }))) return;
    try {
      if (close) await closeMonth(month); else await reopenMonth(month);
      setLocks((set) => { const next = new Set(set); if (close) next.add(month); else next.delete(month); return next; });
      toast(close ? `${label} · ${mt(lang, "closed")}` : mt(lang, "saved"));
    } catch (error) {
      toast(failMessage(error), { tone: "error" });
    }
  };

  const saveBalance = async (month: string, cents: Cents) => {
    try {
      await saveBankBalance(month, cents);
      setBalances((map) => new Map(map).set(month, cents));
      toast(mt(lang, "saved"));
    } catch (error) {
      toast(failMessage(error), { tone: "error" });
    }
  };

  const fileTaxes = async (period: TaxPeriod, owed: Cents) => {
    try {
      await markFiled(period.start, period.end, owed);
      setFilings((map) => new Map(map).set(`${period.start}|${period.end}`, { filedOn: todayISO(), amountCents: owed }));
      toast(mt(lang, "saved"));
    } catch (error) {
      toast(failMessage(error), { tone: "error" });
    }
  };

  const unfileTaxes = async (period: TaxPeriod) => {
    try {
      await unmarkFiled(period.start, period.end);
      setFilings((map) => { const next = new Map(map); next.delete(`${period.start}|${period.end}`); return next; });
    } catch (error) {
      toast(failMessage(error), { tone: "error" });
    }
  };

  const finishWizard = async () => {
    setWizard(false);
    if (!settings.setupCompletedAt) {
      const now = new Date().toISOString();
      try { await saveSettings({ setupCompletedAt: now }); setSettings((s) => ({ ...s, setupCompletedAt: now })); } catch { /* shown again next time */ }
    }
  };

  const reminders = useMemo(() => taxReminders(entries, settings, filings), [entries, settings, filings]);

  const changeSettings = async (patch: Partial<MoneySettings>) => {
    try {
      await saveSettings(patch);
      setSettings((s) => ({ ...s, ...patch }));
      toast(mt(lang, "settingsSaved"));
    } catch (error) {
      toast(failMessage(error), { tone: "error" });
    }
  };

  const changeCategory = async (id: string, patch: Partial<MoneyCategory>) => {
    try {
      await updateCategory(id, patch);
      setCategories((list) => list.map((c) => (c.id === id ? { ...c, ...patch, ...(patch.taxMode ? { taxable: patch.taxMode !== "none" } : {}) } : c)));
    } catch (error) {
      toast(failMessage(error), { tone: "error" });
    }
  };

  return (
    <div className="mn-app" data-lang={lang}>
      <div className="mn-head">
        <nav className="mn-tabs" aria-label={mt(lang, "money")}>
          {TABS.map((t) => (
            <button key={t.id} type="button" className={`mn-tab ${tab === t.id ? "mn-tab-on" : ""}`} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>{mt(lang, t.label)}</button>
          ))}
        </nav>
        <div className="mn-add-bar">
          <button type="button" className="mn-add mn-add-in" onClick={() => openNew("in")}><Plus size={18} aria-hidden="true" />{mt(lang, "moneyIn")}</button>
          <button type="button" className="mn-add mn-add-out" onClick={() => openNew("out")}><Minus size={18} aria-hidden="true" />{mt(lang, "moneyOut")}</button>
        </div>
      </div>

      {!loading && tab !== "taxes" && <TaxReminderBanner lang={lang} reminders={reminders} onOpen={() => setTab("taxes")} />}
      {loadError && <p className="mn-banner mn-banner-error" role="alert">{loadError} <button type="button" className="mn-link" onClick={() => { setLoading(true); void reload(); }}>↻</button></p>}

      {tab === "overview" && (
        <OverviewTab lang={lang} entries={entries} categories={categories} settings={settings} rules={rules} loading={loading} period={period} onPeriod={setPeriod} onOpenEntry={openEdit} onMarkPaid={(e) => void markPaid(e)} onGo={goTo} waveItems={waveItems} onWaveAction={(item, action) => void waveAction(item, action)}
          extraCards={!loading ? <KeepAsideCard lang={lang} entries={entries} settings={settings} filings={filings} /> : null} />
      )}
      {tab === "log" && (
        <LogTab key={logFilter.key} initialFilter={logFilter.value} lang={lang} entries={entries} categories={categories} lockedMonths={locks} loading={loading} onEdit={openEdit} onDelete={(e) => void deleteEntry(e)} onDuplicateLast={lastEntry ? () => duplicate(lastEntry) : null} />
      )}
      {(tab === "monthly" || tab === "quarterly") && !loading && (
        <StatementTab key={`${tab}-${focusMonth ?? ""}-${settings.fiscalYearStartMonth}`} lang={lang} mode={tab} entries={entries} categories={categories} settings={settings} locks={locks} balances={balances} focusMonth={focusMonth}
          onOpenEntry={openEdit} onCloseMonth={(m) => void toggleMonth(m, true)} onReopenMonth={(m) => void toggleMonth(m, false)} onBalance={(m, c) => void saveBalance(m, c)} />
      )}
      {tab === "bills" && !loading && (
        <BillsTab lang={lang} rules={rules} categories={categories} onSave={saveBill} onPause={(r, p) => void pauseBill(r, p)} onSkip={(r, d) => void skipBill(r, d)} onDelete={(r) => void deleteBill(r)} />
      )}
      {tab === "taxes" && !loading && (
        <TaxesTab lang={lang} entries={entries} settings={settings} filings={filings} onFile={(p, o) => void fileTaxes(p, o)} onUnfile={(p) => void unfileTaxes(p)} />
      )}
      {tab === "import" && !loading && (
        <ImportTab lang={lang} entries={entries} categories={categories} parties={parties} settings={settings} locks={locks}
          onImported={async () => { const [e, p] = await Promise.all([loadEntries(), loadParties()]); setEntries(e); setParties(p); }}
          onAddCash={() => openNew("out")} onGoMonthly={() => setTab("monthly")} />
      )}
      {wizard && !loading && (
        <SetupWizard lang={lang} settings={settings} categories={categories} rules={rules} onSaveSettings={changeSettings} onUpdateCategory={changeCategory}
          onSaveBill={(input) => saveBill(input)} onFinish={() => void finishWizard()} onStartImport={() => { void finishWizard(); setTab("import"); }} />
      )}
      {tab === "settings" && !loading && (
        <SettingsTab lang={lang} settings={settings} categories={categories} entries={entries} onSaveSettings={changeSettings} onUpdateCategory={changeCategory} onRestore={(e) => void restore(e)} onOpenWizard={() => setWizard(true)} waveResult={waveResult} onWaveSynced={reload} />
      )}

      {sheet && (
        <EntrySheet
          key={sheet.key}
          lang={lang}
          draft={sheet.draft}
          editing={sheet.editing}
          categories={categories}
          parties={parties}
          clients={clients}
          usage={usage}
          lockedMonths={locks}
          onClose={() => setSheet(null)}
          onSave={saveEntry}
          onDelete={(e) => void deleteEntry(e)}
          onDuplicate={duplicate}
        />
      )}
      <ToastHost toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
