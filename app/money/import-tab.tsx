"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { ArrowLeft, Check, CircleCheck, FileDown, FileSpreadsheet, FileText, Upload, X } from "lucide-react";
import { formatMoney, type Lang } from "../../lib/money/cents";
import { formatDate, monthEnd, monthKey, monthLabel, todayISO } from "../../lib/money/dates";
import { guessMapping, readRows, type BankName, type ColumnMapping, type CsvPreset, type ParsedRow, type RowProblem } from "../../lib/money/csv";
import { isWaveLedger, ledgerToRows, parseWaveLedger, type LedgerRow, type WaveLedger } from "../../lib/money/wave-ledger";
import { guessParty, normalizeText, similarity } from "../../lib/money/matching";
import { monthTitle, quietMonths } from "../../lib/money/insights";
import { fiscalYearRange, presetRange, previousRange } from "../../lib/money/periods";
import { summarize } from "../../lib/money/summary";
import type { Party } from "../../lib/money/repository";
import type { DateRange, MoneyCategory, MoneyEntry, MoneySettings } from "../../lib/money/types";
import { supabase } from "../../lib/supabase";
import { CategoryIcon, Help, Toggle } from "./ui";

type Check = { key: string; status: "new" | "already-imported" | "possible"; reason: string | null; match: { date: string; party: string; totalCents: number; categoryId: string } | null; suggestion: string | null };
type Item = { row: ParsedRow; key: string; status: Check["status"]; match: Check["match"]; categoryId: string | null; party: string; taxesIncluded: boolean; decision: "keep" | "skip" | null; locked: boolean;
  /** Wave General Ledger line: exact GST / QST from the invoice. */
  ledger?: { gstCents: number; qstCents: number; estimated: boolean } };

const BANK_LABEL: Record<BankName, string> = { desjardins: "Desjardins", national: "Banque Nationale", rbc: "RBC", td: "TD", bmo: "BMO", scotia: "Scotiabank", tangerine: "Tangerine", other: "" };
const ledgerToParsed = (r: LedgerRow): ParsedRow => ({ line: r.line, date: r.date, kind: r.kind, totalCents: r.totalCents, description: r.description, party: r.party, account: r.account, taxCents: r.gstCents + r.qstCents });

const L = (lang: Lang, en: string, fr: string) => (lang === "fr" ? fr : en);

async function token() {
  const { data } = await supabase!.auth.getSession();
  return data.session?.access_token ?? "";
}

export function ImportTab({ lang, entries, categories, parties, settings, locks, onImported, onAddCash, onGoMonthly }: {
  lang: Lang; entries: MoneyEntry[]; categories: MoneyCategory[]; parties: Party[]; settings: MoneySettings; locks: Set<string>;
  onImported: () => Promise<void>; onAddCash: () => void; onGoMonthly: () => void;
}) {
  return (
    <div className="mn-import-page">
      <CatchUp lang={lang} entries={entries} settings={settings} onAddCash={onAddCash} onGoMonthly={onGoMonthly} />
      <Importer lang={lang} entries={entries} categories={categories} parties={parties} locks={locks} onImported={onImported} />
      <Exporter lang={lang} settings={settings} />
    </div>
  );
}

/** "Catch up this year": which months look complete, and what to do next. */
export function CatchUp({ lang, entries, settings, onAddCash, onGoMonthly }: { lang: Lang; entries: MoneyEntry[]; settings: MoneySettings; onAddCash: () => void; onGoMonthly: () => void }) {
  const today = todayISO();
  const year = fiscalYearRange(today, settings.fiscalYearStartMonth);
  const quiet = new Set(quietMonths(entries, today).map((m) => m.month));
  const months: Array<{ key: string; state: "ok" | "low" | "empty" }> = [];
  for (let cursor = year.start; cursor <= today; cursor = nextMonth(cursor)) {
    const s = summarize(entries, { start: cursor, end: monthEnd(cursor) });
    const key = cursor.slice(0, 7);
    months.push({ key, state: s.expenseCents === 0 && s.incomeCents === 0 ? "empty" : s.expenseCents === 0 || quiet.has(key) ? "low" : "ok" });
  }
  const hasWave = entries.some((e) => e.source === "import" && e.importKey?.startsWith("wave|"));
  const hasBank = entries.some((e) => e.source === "import" && !e.importKey?.startsWith("wave|"));
  const done = months.filter((m) => m.state === "ok").length;
  const step = (ok: boolean, title: string, text: string, action?: React.ReactNode) => (
    <li className={ok ? "mn-step-done" : ""}><span className="mn-step-dot">{ok ? <Check size={14} /> : null}</span><span><b>{title}</b><small>{text}</small>{action}</span></li>
  );
  return (
    <section className="mn-card mn-catchup">
      <h3>{L(lang, "Catch up this year", "Rattraper l'année")} <span className="mn-count">{done}/{months.length}</span></h3>
      <p className="mn-muted">{L(lang, "Bring in every month from the start of your year to today, so the year view is right from day one. Green months look complete.", "Entrez chaque mois depuis le début de votre année jusqu'à aujourd'hui, pour que la vue annuelle soit juste dès le départ. Les mois en vert semblent complets.")}</p>
      <div className="mn-months">
        {months.map((m) => <span key={m.key} className={`mn-month mn-month-${m.state}`} title={monthTitle(m.key, lang)}>{monthTitle(m.key, lang).replace(/\s\d{4}$/, "").slice(0, 4)}</span>)}
      </div>
      <ol className="mn-steps">
        {step(hasWave, L(lang, "1. Import your Wave export (money in)", "1. Importez votre export Wave (argent reçu)"), L(lang, "Wave → Reports → Account Transactions (General Ledger) → this year → Export CSV. It has your payments, invoices and clients.", "Wave → Rapports → Transactions du compte (grand livre) → cette année → Exporter CSV. Il contient vos paiements, factures et clients."))}
        {step(hasBank, L(lang, "2. Import your bank statements (money out)", "2. Importez vos relevés bancaires (argent dépensé)"), L(lang, "In your bank's website, download each account as CSV from the first day of your year. Keep “money out only” on if Wave already has your income.", "Sur le site de votre banque, téléchargez chaque compte en CSV depuis le premier jour de votre année. Laissez « argent dépensé seulement » si Wave a déjà vos revenus."))}
        {step(false, L(lang, "3. Add cash spending that isn't in the bank", "3. Ajoutez les dépenses comptant absentes de la banque"), "", <button type="button" className="mn-link" onClick={onAddCash}>{L(lang, "– Money out", "– Argent dépensé")}</button>)}
        {step(done === months.length && months.length > 0, L(lang, "4. Check the Monthly tab", "4. Vérifiez l'onglet Par mois"), L(lang, "Amber months probably have something missing.", "Les mois en orange ont probablement un oubli."), <button type="button" className="mn-link" onClick={onGoMonthly}>{L(lang, "Open Monthly", "Ouvrir Par mois")}</button>)}
      </ol>
    </section>
  );
}

function nextMonth(date: string) {
  const [y, m] = date.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function Importer({ lang, entries, categories, parties, locks, onImported }: { lang: Lang; entries: MoneyEntry[]; categories: MoneyCategory[]; parties: Party[]; locks: Set<string>; onImported: () => Promise<void> }) {
  const [step, setStep] = useState<"pick" | "map" | "ledger" | "review" | "done">("pick");
  const [source, setSource] = useState<"bank" | "wave">("bank");
  const [fileName, setFileName] = useState("");
  const [raw, setRaw] = useState<string[][]>([]);
  const [preset, setPreset] = useState<CsvPreset>("bank");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [bank, setBank] = useState<BankName>("other");
  const [ledger, setLedger] = useState<WaveLedger | null>(null);
  const [cashPick, setCashPick] = useState<string[]>([]);
  const [onlyOut, setOnlyOut] = useState(() => entries.some((e) => !e.deletedAt && e.kind === "in"));
  const [items, setItems] = useState<Item[]>([]);
  const [accountMap, setAccountMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const valid = useMemo(() => new Set(categories.filter((c) => c.active).map((c) => c.id)), [categories]);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const name = (c: MoneyCategory) => (lang === "fr" ? c.fr : c.en);

  const parsed: { rows: ParsedRow[]; problems: RowProblem[] } = useMemo(() => (mapping ? readRows(raw, mapping, preset) : { rows: [], problems: [] }), [raw, mapping, preset]);
  const kept = parsed.rows.filter((r) => !(onlyOut && source !== "wave" && r.kind === "in"));
  const ledgerOut = useMemo(() => (ledger ? ledgerToRows(ledger, cashPick) : null), [ledger, cashPick]);
  const headRow = raw[mapping?.skip ?? 0] ?? [];
  const header = mapping?.hasHeader ? headRow : headRow.map((_, i) => `${L(lang, "Column", "Colonne")} ${i + 1}`);

  const readFile = (file: File) => {
    setError(null);
    setFileName(file.name);
    const parse = (encoding: string) => Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy", encoding,
      complete: (res) => {
        const data = (res.data as string[][]).filter((r) => Array.isArray(r));
        if (encoding === "UTF-8" && data.some((r) => r.some((c) => c.includes("�")))) { parse("ISO-8859-1"); return; }
        if (data.length < 1) { setError(L(lang, "This file looks empty.", "Ce fichier semble vide.")); return; }
        if (isWaveLedger(data)) {
          try {
            const parsedLedger = parseWaveLedger(data);
            setLedger(parsedLedger);
            setCashPick(parsedLedger.accounts.filter((a) => a.role === "cash").map((a) => a.name));
            setRaw(data); setPreset("wave"); setSource("wave"); setMapping(null);
            setStep("ledger");
          } catch { setError(L(lang, "This Wave report couldn't be read.", "Ce rapport Wave n'a pas pu être lu.")); }
          return;
        }
        const guess = guessMapping(data);
        setLedger(null);
        setRaw(data);
        setBank(guess.bank);
        setPreset(guess.preset);
        setSource(guess.preset === "wave" ? "wave" : "bank");
        setMapping(guess.mapping);
        setStep("map");
      },
      error: () => setError(L(lang, "This file couldn't be read. Is it a CSV?", "Impossible de lire ce fichier. Est-ce un CSV?")),
    });
    parse("UTF-8");
  };

  const runCheck = async () => {
    const ledgerRows = ledgerOut?.rows ?? null;
    if (ledgerRows ? !ledgerRows.length : !kept.length) return;
    setBusy(true); setError(null);
    try {
      const sendRows = ledgerRows
        ? ledgerRows.map((r) => ({ date: r.date, kind: r.kind, totalCents: r.totalCents, description: r.description, party: r.party, key: r.key }))
        : kept.map((r) => ({ date: r.date, kind: r.kind, totalCents: r.totalCents, description: r.description, party: r.party }));
      const response = await fetch("/api/money/import", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ action: "check", source: preset === "desjardins" ? "desjardins" : source, rows: sendRows }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "error");
      if (ledgerRows) {
        // Every line already has its category, client and exact taxes: new lines start ticked.
        setAccountMap({});
        setItems(ledgerRows.map((r, i) => {
          const c: Check = body.results[i];
          const locked = locks.has(monthKey(r.date));
          return {
            row: ledgerToParsed(r), key: c.key, status: c.status, match: c.match, categoryId: valid.has(r.categoryId) ? r.categoryId : null, party: r.party,
            taxesIncluded: r.gstCents + r.qstCents > 0, ledger: { gstCents: r.gstCents, qstCents: r.qstCents, estimated: r.estimated },
            decision: locked || c.status === "already-imported" ? "skip" : c.status === "new" && valid.has(r.categoryId) ? "keep" : null, locked,
          };
        }));
        setStep("review");
        return;
      }
      const known = [...parties.map((p) => p.name), ...entries.map((e) => e.party).filter(Boolean)];
      // Wave: one category per Wave account, guessed from its name (confirmed below).
      const map: Record<string, string> = {};
      if (preset === "wave") {
        for (const r of kept) {
          if (!r.account || map[`${r.kind}|${r.account}`]) continue;
          const candidates = categories.filter((c) => c.kind === r.kind && c.active);
          const best = candidates.map((c) => ({ c, s: Math.max(similarity(r.account, c.en), similarity(r.account, c.fr)) })).sort((a, b) => b.s - a.s)[0];
          map[`${r.kind}|${r.account}`] = best && best.s >= 0.5 ? best.c.id : r.kind === "in" ? (/sale|vente|revenu|service/i.test(r.account) ? "labour_revenue" : "other_income") : "other_expenses";
        }
      }
      setAccountMap(map);
      setItems(kept.map((row, i) => {
        const c: Check = body.results[i];
        const locked = locks.has(monthKey(row.date));
        const party = row.party || guessParty(row.description, known);
        const suggestion = preset === "wave" ? map[`${row.kind}|${row.account}`] : c.suggestion && valid.has(c.suggestion) ? c.suggestion : null;
        const category = suggestion ? byId.get(suggestion) : undefined;
        return {
          row, key: c.key, status: c.status, match: c.match, categoryId: suggestion, party,
          taxesIncluded: row.taxCents !== null ? row.taxCents > 0 : category?.taxable ?? true,
          decision: c.status === "new" && !locked ? null : "skip", locked,
        };
      }));
      setStep("review");
    } catch {
      setError(L(lang, "The check didn't work. Nothing was imported. Try again.", "La vérification n'a pas fonctionné. Rien n'a été importé. Réessayez."));
    } finally {
      setBusy(false);
    }
  };

  const update = (index: number, patch: Partial<Item>) => setItems((list) => {
    const next = list.slice();
    next[index] = { ...next[index], ...patch };
    // Supplier memory inside this file: the same supplier gets the same category automatically.
    if (patch.categoryId) {
      const who = normalizeText(next[index].party);
      if (who) next.forEach((it, j) => { if (j !== index && it.decision === null && !it.categoryId && it.row.kind === next[index].row.kind && normalizeText(it.party) === who) next[j] = { ...it, categoryId: patch.categoryId!, taxesIncluded: byId.get(patch.categoryId!)?.taxable ?? it.taxesIncluded }; });
    }
    return next;
  });

  const applyAccount = (key: string, categoryId: string) => {
    setAccountMap((m) => ({ ...m, [key]: categoryId }));
    setItems((list) => list.map((it) => (preset === "wave" && `${it.row.kind}|${it.row.account}` === key ? { ...it, categoryId } : it)));
  };

  const commit = async () => {
    const rows = items.filter((it) => it.decision === "keep" && it.categoryId);
    if (!rows.length) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/money/import", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({
        action: "commit", source: preset === "desjardins" ? "desjardins" : source, fileName,
        rows: rows.map((it) => ({ date: it.row.date, kind: it.row.kind, totalCents: it.row.totalCents, description: it.row.description, party: it.party, key: it.key, categoryId: it.categoryId, taxesIncluded: it.taxesIncluded, taxCents: preset === "wave" && !it.ledger ? it.row.taxCents : null, gstCents: it.ledger?.gstCents ?? null, qstCents: it.ledger?.qstCents ?? null })),
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === "month_locked" ? "locked" : "error");
      setResult({ created: body.created, skipped: items.length - body.created });
      setStep("done");
      await onImported();
    } catch (e) {
      setError(e instanceof Error && e.message === "locked" ? L(lang, "Some rows are in a closed month. Reopen it or skip those rows.", "Certaines lignes sont dans un mois fermé. Rouvrez-le ou sautez ces lignes.") : L(lang, "Saving didn't work. Nothing was imported. Try again.", "L'enregistrement n'a pas fonctionné. Rien n'a été importé. Réessayez."));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setStep("pick"); setRaw([]); setMapping(null); setLedger(null); setItems([]); setResult(null); setError(null); setOnlyOut(entries.some((e) => !e.deletedAt && e.kind === "in")); if (fileRef.current) fileRef.current.value = ""; };
  const pending = items.findIndex((it) => it.decision === null);
  const counts = { keep: items.filter((i) => i.decision === "keep").length, skip: items.filter((i) => i.decision === "skip").length, todo: items.filter((i) => i.decision === null).length, ready: items.filter((i) => i.decision === null && i.categoryId).length };
  const sel = (label: string, value: number | null, onChange: (v: number | null) => void, optional = false) => (
    <label className="mn-field">{label}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
        {optional && <option value="">—</option>}
        {header.map((h, i) => <option key={i} value={i}>{h || `${L(lang, "Column", "Colonne")} ${i + 1}`}</option>)}
      </select>
    </label>
  );

  return (
    <section className="mn-card mn-importer" aria-live="polite">
      <h3><Upload size={17} aria-hidden="true" /> {L(lang, "Import a CSV (bank or Wave)", "Importer un CSV (banque ou Wave)")}</h3>
      {error && <p className="mn-banner mn-banner-error" role="alert">{error}</p>}

      {step === "pick" && (
        <div className="mn-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) readFile(f); }}>
          <p>{L(lang, "Drop a .csv file here, or", "Déposez un fichier .csv ici, ou")}</p>
          <button type="button" className="mn-primary" onClick={() => fileRef.current?.click()}>{L(lang, "Choose a file", "Choisir un fichier")}</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
          <small className="mn-muted">{L(lang, "Desjardins, National Bank, RBC, TD, BMO, Scotiabank, credit cards and Wave exports work. Nothing is saved until you confirm.", "Les exports Desjardins, Banque Nationale, RBC, TD, BMO, Scotia, cartes de crédit et Wave fonctionnent. Rien n'est enregistré avant votre confirmation.")}</small>
        </div>
      )}

      {step === "map" && mapping && (
        <div className="mn-map">
          <p className="mn-muted"><b>{fileName}</b> · {preset === "wave" ? "Wave" : preset === "desjardins" ? "Desjardins" : BANK_LABEL[bank] || L(lang, "Bank / card", "Banque / carte")} · {parsed.rows.length} {L(lang, "lines read", "lignes lues")}{parsed.problems.length ? ` · ${parsed.problems.length} ${L(lang, "ignored", "ignorées")}` : ""}</p>
          {preset !== "wave" && (
            <div className="mn-map-grid">
              {sel(L(lang, "Date", "Date"), mapping.date, (v) => setMapping({ ...mapping, date: v ?? 0 }))}
              {sel(L(lang, "Description", "Description"), mapping.description, (v) => setMapping({ ...mapping, description: v ?? 0 }))}
              {mapping.amount !== null
                ? sel(L(lang, "Amount (− = money out)", "Montant (− = dépense)"), mapping.amount, (v) => setMapping({ ...mapping, amount: v }))
                : <>{sel(L(lang, "Money out column", "Colonne retraits"), mapping.debit, (v) => setMapping({ ...mapping, debit: v }), true)}{sel(L(lang, "Money in column", "Colonne dépôts"), mapping.credit, (v) => setMapping({ ...mapping, credit: v }), true)}</>}
              <label className="mn-field">{L(lang, "Date format", "Format de date")}
                <select value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as ColumnMapping["dateFormat"] })}>
                  <option value="ymd">2026-11-05</option><option value="mdy">11/05/2026 (MM/DD)</option><option value="dmy">05/11/2026 (DD/MM)</option>
                </select>
              </label>
            </div>
          )}
          <div className="mn-map-toggles">
            {preset !== "wave" && <Toggle checked={mapping.flipSigns} onChange={(v) => setMapping({ ...mapping, flipSigns: v })} label={L(lang, "Swap money in / out (credit cards)", "Inverser reçu / dépensé (cartes de crédit)")} />}
            {preset !== "wave" && <Toggle checked={onlyOut} onChange={setOnlyOut} label={L(lang, "Money out only (Wave already has my income)", "Argent dépensé seulement (Wave a déjà mes revenus)")} />}
            <Toggle checked={mapping.hasHeader} onChange={(v) => setMapping({ ...mapping, hasHeader: v })} label={L(lang, "First line is titles", "La première ligne contient les titres")} />
          </div>
          <div className="mn-st-scroll">
            <table className="mn-mini-table">
              <thead><tr><th>{L(lang, "Date", "Date")}</th><th>{L(lang, "Description", "Description")}</th><th>{L(lang, "In / out", "Reçu / dépensé")}</th><th>{L(lang, "Amount", "Montant")}</th></tr></thead>
              <tbody>{kept.slice(0, 8).map((r) => <tr key={r.line}><th scope="row">{r.date}</th><td className="mn-cell-text">{r.party || r.description}{preset === "wave" && r.account ? ` · ${r.account}` : ""}</td><td className="mn-cell-text">{r.kind === "in" ? L(lang, "In", "Reçu") : L(lang, "Out", "Dépensé")}</td><td className={r.kind === "in" ? "mn-in" : "mn-out"}>{formatMoney(r.totalCents, lang)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="mn-form-actions mn-inline-actions">
            <button type="button" className="mn-ghost" onClick={reset}><ArrowLeft size={15} />{L(lang, "Another file", "Autre fichier")}</button>
            <button type="button" className="mn-primary" disabled={busy || !kept.length} onClick={() => void runCheck()}>{busy ? mt2(lang) : `${L(lang, "Check", "Vérifier")} ${kept.length} ${L(lang, "lines", "lignes")}`}</button>
          </div>
        </div>
      )}

      {step === "ledger" && ledger && ledgerOut && <LedgerStep lang={lang} fileName={fileName} ledger={ledger} result={ledgerOut} cashPick={cashPick} onCashPick={setCashPick} busy={busy} onBack={reset} onCheck={() => void runCheck()} />}

      {step === "review" && (
        <div className="mn-review">
          <p className="mn-review-sum">
            <span><b>{counts.keep}</b> {L(lang, "to import", "à importer")}</span>
            <span><b>{counts.todo}</b> {L(lang, "to review", "à vérifier")}</span>
            <span><b>{counts.skip}</b> {L(lang, "skipped (duplicates, closed months)", "sautées (doublons, mois fermés)")}</span>
          </p>
          {preset === "wave" && Object.keys(accountMap).length > 0 && (
            <div className="mn-account-map">
              <b>{L(lang, "Wave accounts → your categories", "Comptes Wave → vos catégories")}</b>
              {Object.entries(accountMap).map(([key, value]) => {
                const [kind, account] = [key.split("|")[0], key.slice(key.indexOf("|") + 1)];
                return (
                  <label key={key} className="mn-account-row"><span>{account}</span>
                    <select value={value} onChange={(e) => applyAccount(key, e.target.value)}>
                      {categories.filter((c) => c.kind === kind && c.active).map((c) => <option key={c.id} value={c.id}>{name(c)}</option>)}
                    </select>
                  </label>
                );
              })}
            </div>
          )}
          {counts.ready > 0 && <button type="button" className="mn-ghost" onClick={() => setItems((list) => list.map((it) => (it.decision === null && it.categoryId ? { ...it, decision: "keep" } : it)))}><Check size={15} />{L(lang, `Accept all ${counts.ready} with a category`, `Accepter les ${counts.ready} qui ont une catégorie`)}</button>}

          {pending >= 0 ? (
            <ReviewCard key={pending} lang={lang} item={items[pending]} position={`${items.filter((i) => i.decision !== null).length + 1} / ${items.length}`} categories={categories.filter((c) => c.kind === items[pending].row.kind && c.active)} byId={byId}
              onChange={(patch) => update(pending, patch)} onKeep={() => items[pending].categoryId && update(pending, { decision: "keep" })} onSkip={() => update(pending, { decision: "skip" })} />
          ) : <p className="mn-all-good"><CircleCheck size={18} />{L(lang, "Everything is reviewed.", "Tout est vérifié.")}</p>}

          <details className="mn-review-list">
            <summary>{L(lang, "See every line", "Voir toutes les lignes")} ({items.length})</summary>
            <ul className="mn-plain-list">
              {items.map((it, i) => (
                <li key={it.key} className={`mn-review-row mn-review-${it.decision ?? "todo"}`}>
                  <span className="mn-review-date">{it.row.date}</span>
                  <span className="mn-review-desc">{it.party || it.row.description}{it.status === "already-imported" ? ` · ${L(lang, "already imported", "déjà importée")}` : it.status === "possible" ? ` · ${L(lang, "looks like an entry already logged", "ressemble à une entrée déjà inscrite")}` : it.locked ? ` · ${L(lang, "closed month", "mois fermé")}` : ""}</span>
                  <span className={it.row.kind === "in" ? "mn-in mn-amount" : "mn-out mn-amount"}>{formatMoney(it.row.totalCents, lang)}</span>
                  <span>{it.categoryId ? name(byId.get(it.categoryId)!) : "—"}</span>
                  {it.status !== "already-imported" && !it.locked && <button type="button" className="mn-link" onClick={() => update(i, { decision: it.decision === "keep" ? "skip" : it.categoryId ? "keep" : null })}>{it.decision === "keep" ? L(lang, "Skip", "Sauter") : L(lang, "Import", "Importer")}</button>}
                </li>
              ))}
            </ul>
          </details>
          <div className="mn-form-actions mn-inline-actions">
            <button type="button" className="mn-ghost" onClick={reset}><X size={15} />{L(lang, "Cancel", "Annuler")}</button>
            <button type="button" className="mn-primary mn-primary-in" disabled={busy || !counts.keep} onClick={() => void commit()}>{busy ? mt2(lang) : L(lang, `Import ${counts.keep} entries`, `Importer ${counts.keep} entrées`)}</button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="mn-done">
          <p className="mn-all-good"><CircleCheck size={20} />{L(lang, `${result.created} entries imported. ${result.skipped} skipped.`, `${result.created} entrées importées. ${result.skipped} sautées.`)}</p>
          <p className="mn-muted">{L(lang, "Suppliers you confirmed are remembered: next time their category is picked for you.", "Les fournisseurs confirmés sont mémorisés : la prochaine fois, leur catégorie sera choisie pour vous.")}</p>
          <button type="button" className="mn-ghost" onClick={reset}>{L(lang, "Import another file", "Importer un autre fichier")}</button>
        </div>
      )}
    </section>
  );
}

/** Wave General Ledger: which accounts are cash, and a month-by-month dry run before anything is checked or saved. */
function LedgerStep({ lang, fileName, ledger, result, cashPick, onCashPick, busy, onBack, onCheck }: {
  lang: Lang; fileName: string; ledger: WaveLedger; result: ReturnType<typeof ledgerToRows>; cashPick: string[]; onCashPick: (v: string[]) => void; busy: boolean; onBack: () => void; onCheck: () => void;
}) {
  const $ = (c: number) => formatMoney(c, lang);
  const sum = (f: (m: (typeof result.months)[number]) => number) => result.months.reduce((s, m) => s + f(m), 0);
  const ins = result.rows.filter((r) => r.kind === "in");
  const gst = ins.reduce((s, r) => s + r.gstCents, 0);
  const qst = ins.reduce((s, r) => s + r.qstCents, 0);
  const count = (t: string) => result.notes.filter((n) => n.type === t).length;
  const roleName: Record<string, [string, string]> = {
    receivable: ["invoice totals", "totaux des factures"], sales: ["what each invoice was for", "le détail de chaque facture"], gst: ["GST per invoice", "TPS par facture"], qst: ["QST per invoice", "TVQ par facture"],
    merchant_fees: ["card fees", "frais de carte"], customer_credits: ["deposits", "dépôts"], invoice_charge: ["invoice surcharge", "frais ajoutés aux factures"], other: ["not used", "non utilisé"],
  };
  const cashAccounts = ledger.accounts.filter((a) => a.role === "cash" || cashPick.includes(a.name));
  const helpers = ledger.accounts.filter((a) => !cashAccounts.includes(a));
  const monthName = (m: string) => `${monthLabel(Number(m.slice(5, 7)), lang)} ${m.slice(0, 4)}`;
  return (
    <div className="mn-map mn-ledger">
      <p className="mn-muted"><b>{fileName}</b> · Wave · {L(lang, "General Ledger", "Grand livre")}{ledger.from && ledger.to ? ` · ${formatDate(ledger.from, lang, { year: true })} – ${formatDate(ledger.to, lang, { year: true })}` : ""}</p>
      <p className="mn-ledger-explain">{L(lang,
        "Only money that actually came in or went out of these accounts is counted, so each payment counts once. The other accounts are only used to split each payment into labour, parts and service calls with its exact GST and QST.",
        "Seul l'argent réellement entré ou sorti de ces comptes est compté : chaque paiement compte une seule fois. Les autres comptes servent seulement à répartir chaque paiement (main-d'œuvre, pièces, appels de service) avec sa TPS et sa TVQ exactes.")}</p>
      <div className="mn-map-toggles">
        {cashAccounts.map((a) => (
          <Toggle key={a.name} checked={cashPick.includes(a.name)} onChange={(v) => onCashPick(v ? [...cashPick, a.name] : cashPick.filter((n) => n !== a.name))}
            label={`${a.name} · ${a.lines} ${L(lang, "lines", "lignes")}`} />
        ))}
      </div>
      <small className="mn-muted">{L(lang, "Used for details:", "Utilisés pour les détails :")} {helpers.map((a) => `${a.name} (${L(lang, ...(roleName[a.role] ?? roleName.other))})`).join(" · ")}</small>

      <p className="mn-review-sum">
        <span><b>{result.rows.length}</b> {L(lang, "entries", "entrées")}</span>
        <span><b className="mn-in">{$(sum((m) => m.inCents))}</b> {L(lang, "money in", "reçu")} ({$(sum((m) => m.inNetCents))} {L(lang, "before taxes", "avant taxes")})</span>
        <span><b className="mn-out">{$(sum((m) => m.outCents))}</b> {L(lang, "money out", "dépensé")}</span>
        <span>{L(lang, "GST", "TPS")} <b>{$(gst)}</b> · {L(lang, "QST", "TVQ")} <b>{$(qst)}</b></span>
      </p>
      <div className="mn-st-scroll">
        <table className="mn-mini-table mn-ledger-table">
          <thead><tr>
            <th scope="col">{L(lang, "Month", "Mois")}</th><th scope="col">{L(lang, "Entries", "Entrées")}</th>
            <th scope="col">{L(lang, "Money in", "Reçu")}</th><th scope="col">{L(lang, "Before taxes", "Avant taxes")}</th><th scope="col">{L(lang, "Wave sales (P&L)", "Ventes Wave (É.R.)")}</th>
            <th scope="col">{L(lang, "Money out", "Dépensé")}</th><th scope="col">{L(lang, "Wave expenses (P&L)", "Dépenses Wave (É.R.)")}</th>
          </tr></thead>
          <tbody>
            {result.months.map((m) => (
              <tr key={m.month}>
                <th scope="row">{monthName(m.month)}</th><td>{m.inCount + m.outCount}</td>
                <td className="mn-in">{$(m.inCents)}</td><td>{$(m.inNetCents)}</td><td>{$(m.waveIncomeCents)}</td>
                <td className="mn-out">{$(m.outCents)}</td><td>{$(m.waveFeesCents)}</td>
              </tr>
            ))}
            <tr className="mn-total-row">
              <th scope="row">{L(lang, "Total", "Total")}</th><td>{result.rows.length}</td>
              <td className="mn-in">{$(sum((m) => m.inCents))}</td><td>{$(sum((m) => m.inNetCents))}</td><td>{$(sum((m) => m.waveIncomeCents))}</td>
              <td className="mn-out">{$(sum((m) => m.outCents))}</td><td>{$(sum((m) => m.waveFeesCents))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mn-muted mn-ledger-explain">{L(lang,
        "Why months differ from Wave: Wave's Profit & Loss counts an invoice when it's sent; Money counts it when you're paid. Money out here is Wave's card fees, added back so “money in” is what clients actually paid.",
        "Pourquoi les mois diffèrent de Wave : l'état des résultats de Wave compte une facture quand elle est envoyée; Argent la compte quand vous êtes payé. L'argent dépensé ici, ce sont les frais de carte de Wave, rajoutés pour que « reçu » soit ce que les clients ont vraiment payé.")}</p>
      {result.notes.length > 0 && (
        <details className="mn-review-list">
          <summary>{[
            count("reversal") && L(lang, `${count("reversal")} payment(s) taken back, not counted`, `${count("reversal")} paiement(s) annulé(s), non comptés`),
            count("refund-netted") && L(lang, `${count("refund-netted")} refund(s) taken off their payment`, `${count("refund-netted")} remboursement(s) déduit(s) du paiement`),
            count("no-invoice") && L(lang, `${count("no-invoice")} payment(s) without invoice details: standard taxes assumed`, `${count("no-invoice")} paiement(s) sans détail de facture : taxes standard`),
            count("transfer") && L(lang, `${count("transfer")} transfer(s) between accounts ignored`, `${count("transfer")} virement(s) entre comptes ignoré(s)`),
            count("refund") && L(lang, `${count("refund")} refund(s) logged as money out`, `${count("refund")} remboursement(s) inscrit(s) comme dépense`),
          ].filter(Boolean).join(" · ")}</summary>
          <ul className="mn-plain-list">
            {result.notes.map((n, i) => <li key={i} className="mn-review-row"><span className="mn-review-date">{n.date}</span><span className="mn-review-desc">{n.description} · {n.account}</span><span className="mn-amount">{$(n.cents)}</span></li>)}
          </ul>
        </details>
      )}
      <p className="mn-muted">{L(lang, "Nothing is saved yet. Next: a duplicate check against what's already in Money.", "Rien n'est encore enregistré. Ensuite : vérification des doublons avec ce qui est déjà dans Argent.")}</p>
      <div className="mn-form-actions mn-inline-actions">
        <button type="button" className="mn-ghost" onClick={onBack}><ArrowLeft size={15} />{L(lang, "Another file", "Autre fichier")}</button>
        <button type="button" className="mn-primary" disabled={busy || !result.rows.length} onClick={onCheck}>{busy ? mt2(lang) : `${L(lang, "Check", "Vérifier")} ${result.rows.length} ${L(lang, "entries", "entrées")}`}</button>
      </div>
    </div>
  );
}

function mt2(lang: Lang) { return L(lang, "One moment…", "Un instant…"); }

/** One line at a time: pick/confirm the category, then Keep (or swipe right) / Skip (or swipe left). */
function ReviewCard({ lang, item, position, categories, byId, onChange, onKeep, onSkip }: { lang: Lang; item: Item; position: string; categories: MoneyCategory[]; byId: Map<string, MoneyCategory>; onChange: (p: Partial<Item>) => void; onKeep: () => void; onSkip: () => void }) {
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const moved = useRef(0);
  const end = () => {
    if (start.current === null) return;
    start.current = null;
    if (moved.current > 110 && item.categoryId) onKeep();
    else if (moved.current < -110) onSkip();
    moved.current = 0;
    setDx(0);
  };
  return (
    <div className="mn-review-card" style={{ transform: dx ? `translateX(${dx}px) rotate(${dx / 40}deg)` : undefined }}
      onPointerDown={(e) => { if (e.pointerType !== "mouse" && !(e.target as HTMLElement).closest("button,input,select")) { start.current = e.clientX; } }}
      onPointerMove={(e) => { if (start.current !== null) { moved.current = e.clientX - start.current; setDx(moved.current); } }}
      onPointerUp={end} onPointerCancel={end}>
      <div className="mn-review-top">
        <span className="mn-muted">{position} · {formatDate(item.row.date, lang)}</span>
        <span className={`mn-amount mn-${item.row.kind} mn-review-amount`}>{formatMoney(item.row.kind === "in" ? item.row.totalCents : -item.row.totalCents, lang)}</span>
      </div>
      <p className="mn-review-raw">{item.row.description || "—"}{item.row.account ? ` · ${item.row.account}` : ""}</p>
      {item.match && <p className="mn-banner mn-banner-warn">{L(lang, "Looks like", "Ressemble à")}: {item.match.party || "—"} · {formatDate(item.match.date, lang)} · {formatMoney(item.match.totalCents, lang)}</p>}
      <label className="mn-field">{item.row.kind === "in" ? L(lang, "Client", "Client") : L(lang, "Store / supplier", "Magasin / fournisseur")}<input value={item.party} onChange={(e) => onChange({ party: e.target.value })} /></label>
      <div className="mn-tiles mn-tiles-small">
        {categories.map((c) => (
          <button key={c.id} type="button" className={`mn-tile ${item.categoryId === c.id ? "mn-tile-on" : ""}`} aria-pressed={item.categoryId === c.id} onClick={() => onChange({ categoryId: c.id, taxesIncluded: item.row.taxCents !== null ? item.taxesIncluded : byId.get(c.id)?.taxable ?? item.taxesIncluded })}>
            <CategoryIcon name={c.icon} size={16} /><span>{lang === "fr" ? c.fr : c.en}</span>
          </button>
        ))}
      </div>
      {item.row.taxCents === null && <Toggle checked={item.taxesIncluded} onChange={(v) => onChange({ taxesIncluded: v })} label={L(lang, "GST + QST included?", "TPS + TVQ incluses?")} />}
      <div className="mn-review-actions">
        <button type="button" className="mn-ghost" onClick={onSkip}><X size={16} />{L(lang, "Skip", "Sauter")}</button>
        <button type="button" className="mn-primary mn-primary-in" disabled={!item.categoryId} onClick={onKeep}><Check size={16} />{L(lang, "Keep", "Garder")}</button>
      </div>
      <small className="mn-muted mn-swipe-hint">{L(lang, "On a phone: swipe right to keep, left to skip.", "Sur téléphone : glissez à droite pour garder, à gauche pour sauter.")}</small>
    </div>
  );
}

function Exporter({ lang, settings }: { lang: Lang; settings: MoneySettings }) {
  const today = todayISO();
  const options: Array<{ id: string; label: string; range: DateRange }> = [
    { id: "lastMonth", label: L(lang, "Last month", "Mois dernier"), range: presetRange("lastMonth", today, settings) },
    { id: "lastQuarter", label: L(lang, "Last quarter", "Trimestre dernier"), range: previousRange(presetRange("thisQuarter", today, settings)) },
    { id: "thisYear", label: L(lang, "This year so far", "Cette année à ce jour"), range: { start: fiscalYearRange(today, settings.fiscalYearStartMonth).start, end: today } },
    { id: "lastYear", label: L(lang, "Last year", "L'an dernier"), range: previousRange(fiscalYearRange(today, settings.fiscalYearStartMonth)) },
  ];
  const [choice, setChoice] = useState("lastQuarter");
  const [custom, setCustom] = useState<DateRange>(options[1].range);
  const [docLang, setDocLang] = useState<Lang>(lang);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const range = choice === "custom" ? custom : options.find((o) => o.id === choice)!.range;
  const download = async (format: "pdf" | "xlsx") => {
    setBusy(format); setError(false);
    try {
      const response = await fetch(`/api/money/export?format=${format}&start=${range.start}&end=${range.end}&lang=${docLang}`, { headers: { Authorization: `Bearer ${await token()}` } });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? `rpm-diesel.${format}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="mn-card mn-exporter">
      <h3><FileDown size={17} aria-hidden="true" /> {L(lang, "Send to my accountant", "Envoyer à mon comptable")}</h3>
      <p className="mn-muted">{L(lang, "A clean PDF summary and an Excel file with every entry, the taxes and the totals by category. Uses real accounting terms.", "Un sommaire PDF et un fichier Excel avec chaque entrée, les taxes et les totaux par catégorie. Avec les vrais termes comptables.")}</p>
      <div className="mn-chips mn-chips-scroll">
        {options.map((o) => <button key={o.id} type="button" className={`mn-chip ${choice === o.id ? "mn-chip-on" : ""}`} onClick={() => setChoice(o.id)}>{o.label}</button>)}
        <button type="button" className={`mn-chip ${choice === "custom" ? "mn-chip-on" : ""}`} onClick={() => setChoice("custom")}>{L(lang, "Custom", "Personnalisé")}</button>
      </div>
      {choice === "custom" ? (
        <div className="mn-custom-range">
          <label>{L(lang, "From", "Du")}<input type="date" value={custom.start} max={custom.end} onChange={(e) => e.target.value && setCustom({ ...custom, start: e.target.value })} /></label>
          <label>{L(lang, "To", "Au")}<input type="date" value={custom.end} min={custom.start} onChange={(e) => e.target.value && setCustom({ ...custom, end: e.target.value })} /></label>
        </div>
      ) : <p className="mn-period-label">{formatDate(range.start, lang)} – {formatDate(range.end, lang)}</p>}
      <div className="mn-export-row">
        <label className="mn-field mn-field-inline">{L(lang, "Language of the documents", "Langue des documents")}
          <select value={docLang} onChange={(e) => setDocLang(e.target.value as Lang)}><option value="fr">Français</option><option value="en">English</option></select>
        </label>
        <button type="button" className="mn-ghost" disabled={Boolean(busy)} onClick={() => void download("pdf")}><FileText size={16} />{busy === "pdf" ? mt2(lang) : L(lang, "PDF summary", "Sommaire PDF")}</button>
        <button type="button" className="mn-ghost" disabled={Boolean(busy)} onClick={() => void download("xlsx")}><FileSpreadsheet size={16} />{busy === "xlsx" ? mt2(lang) : L(lang, "Excel file", "Fichier Excel")}</button>
      </div>
      {error && <p className="mn-problem">{L(lang, "The file couldn't be made. Try again.", "Le fichier n'a pas pu être créé. Réessayez.")}</p>}
      <small className="mn-muted">{L(lang, "Only Admins can download these.", "Seuls les administrateurs peuvent les télécharger.")} <Help lang={lang} topic="statement" /></small>
    </section>
  );
}
