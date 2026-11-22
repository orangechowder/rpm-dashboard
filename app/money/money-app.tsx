"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import "./money.css";
import type { Lang } from "../../lib/money/cents";
import { addDays, todayISO } from "../../lib/money/dates";
import {
  MoneyError, createEntry, loadCategories, loadEntries, loadLocks, loadParties, loadSettings, rememberParty, restoreEntry,
  saveSettings, trashEntry, updateCategory, updateEntry, uploadReceipt, type EntryInput, type Party,
} from "../../lib/money/repository";
import { DEFAULT_SETTINGS, type MoneyCategory, type MoneyEntry, type MoneySettings } from "../../lib/money/types";
import { EntrySheet, type EntryDraft } from "./entry-sheet";
import { mt, type MoneyKey } from "./i18n";
import { LogTab, type Filter } from "./log-tab";
import { initialPeriod, OverviewTab, type PeriodState } from "./overview-tab";
import { SettingsTab } from "./settings-tab";
import { ToastHost, type Toast } from "./ui";

export type MoneyTab = "overview" | "log" | "monthly" | "quarterly" | "bills" | "taxes" | "import" | "settings";
const TABS: Array<{ id: MoneyTab; label: MoneyKey }> = [
  { id: "overview", label: "tabOverview" },
  { id: "log", label: "tabLog" },
  { id: "settings", label: "tabSettings" },
];

export default function MoneyApp({ language, clients }: { language: Lang; clients: string[] }) {
  const lang = language;
  const [tab, setTab] = useState<MoneyTab>("overview");
  const [period, setPeriod] = useState<PeriodState>(initialPeriod);
  const [focusMonth, setFocusMonth] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entries, setEntries] = useState<MoneyEntry[]>([]);
  const [categories, setCategories] = useState<MoneyCategory[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [settings, setSettings] = useState<MoneySettings>(DEFAULT_SETTINGS);
  const [locks, setLocks] = useState<Set<string>>(new Set());
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

  const reload = useCallback(async () => {
    try {
      const [e, c, p, s, l] = await Promise.all([loadEntries(), loadCategories(), loadParties(), loadSettings(), loadLocks()]);
      setEntries(e); setCategories(c); setParties(p); setSettings(s); setLocks(l);
      setLoadError(null);
    } catch (error) {
      setLoadError(failMessage(error));
    } finally {
      setLoading(false);
    }
  }, [failMessage]);

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
  const goTo = (next: "bills" | "monthly" | "import" | "log-receipts", month?: string) => {
    if (month) setFocusMonth(month);
    if (next === "log-receipts") { setLogFilter({ value: "receipt", key: Date.now() }); setTab("log"); return; }
    setTab(next);
  };

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
      setCategories((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
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

      {loadError && <p className="mn-banner mn-banner-error" role="alert">{loadError} <button type="button" className="mn-link" onClick={() => { setLoading(true); void reload(); }}>↻</button></p>}

      {tab === "overview" && (
        <OverviewTab lang={lang} entries={entries} categories={categories} settings={settings} rules={[]} loading={loading} period={period} onPeriod={setPeriod} onOpenEntry={openEdit} onMarkPaid={(e) => void markPaid(e)} onGo={goTo} />
      )}
      {tab === "log" && (
        <LogTab key={logFilter.key} initialFilter={logFilter.value} lang={lang} entries={entries} categories={categories} lockedMonths={locks} loading={loading} onEdit={openEdit} onDelete={(e) => void deleteEntry(e)} onDuplicateLast={lastEntry ? () => duplicate(lastEntry) : null} />
      )}
      {tab === "settings" && !loading && (
        <SettingsTab lang={lang} settings={settings} categories={categories} entries={entries} onSaveSettings={changeSettings} onUpdateCategory={changeCategory} onRestore={(e) => void restore(e)} onOpenWizard={() => undefined} />
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
