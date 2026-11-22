"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, LockOpen } from "lucide-react";
import { formatMoney, formatPercent, parseMoney, centsToInput, type Cents, type Lang } from "../../lib/money/cents";
import { addMonths, formatDate, monthLabel, todayISO } from "../../lib/money/dates";
import { fiscalMonths, fiscalQuarters, fiscalYearByStartYear, fiscalYearLabel, fiscalYearStart } from "../../lib/money/periods";
import { cashNet, isLive, statement, type Results, type StatementColumn } from "../../lib/money/summary";
import type { MoneyCategory, MoneyEntry, MoneySettings } from "../../lib/money/types";
import { mt, type HelpKey } from "./i18n";
import { Amount, CategoryIcon, Help, Sheet } from "./ui";

type Drill = { title: string; entries: MoneyEntry[]; totalCents: Cents };

export function StatementTab({
  lang, mode, entries, categories, settings, locks, balances, focusMonth, onOpenEntry, onCloseMonth, onReopenMonth, onBalance,
}: {
  lang: Lang;
  mode: "monthly" | "quarterly";
  entries: MoneyEntry[];
  categories: MoneyCategory[];
  settings: MoneySettings;
  locks: Set<string>;
  balances: Map<string, Cents>;
  focusMonth: string | null;
  onOpenEntry: (entry: MoneyEntry) => void;
  onCloseMonth: (month: string) => void;
  onReopenMonth: (month: string) => void;
  onBalance: (month: string, cents: Cents) => void;
}) {
  const startMonth = settings.fiscalYearStartMonth;
  const todayYear = Number(fiscalYearStart(todayISO(), startMonth).slice(0, 4));
  const firstYear = useMemo(() => {
    const dates = entries.filter(isLive).map((e) => e.date).sort();
    return dates.length ? Math.min(Number(fiscalYearStart(dates[0], startMonth).slice(0, 4)), todayYear) : todayYear;
  }, [entries, startMonth, todayYear]);
  const [year, setYear] = useState(() => (focusMonth ? Number(fiscalYearStart(`${focusMonth}-01`, startMonth).slice(0, 4)) : todayYear));
  const [drill, setDrill] = useState<Drill | null>(null);
  const range = fiscalYearByStartYear(year, startMonth);
  const months = fiscalMonths(range);
  const columns: StatementColumn[] = mode === "monthly" ? months : fiscalQuarters(range);
  // Like the spreadsheet, the first column has no growth ("–").
  const st = statement(entries, columns);
  const income = categories.filter((c) => c.kind === "in" && (c.active || (st.total.byCategory[c.id] ?? 0) !== 0));
  const expenses = categories.filter((c) => c.kind === "out" && (c.active || (st.total.byCategory[c.id] ?? 0) !== 0));
  const name = (c: MoneyCategory) => (lang === "fr" ? c.fr : c.en);
  const colLabel = (column: StatementColumn) => (mode === "monthly" ? monthLabel(Number(column.start.slice(5, 7)), lang) : column.key.replace("Q", lang === "fr" ? "T" : "Q"));

  const openDrill = (title: string, filter: (e: MoneyEntry) => boolean, start: string, end: string) => {
    const list = entries.filter((e) => isLive(e) && e.date >= start && e.date <= end && filter(e)).sort((a, b) => a.date.localeCompare(b.date));
    setDrill({ title, entries: list, totalCents: list.reduce((s, e) => s + (e.kind === "in" ? e.netCents : -e.netCents), 0) });
  };

  const money = (cents: Cents, onClick: () => void, tone: "in" | "out" | "auto" | "plain" = "plain", strong = false, key?: string) => (
    <td key={key} className={strong ? "mn-st-strong" : ""}>
      {cents === 0 ? <span className="mn-st-zero">—</span> : <button type="button" className="mn-st-cell" onClick={onClick}><Amount cents={cents} lang={lang} tone={tone} /></button>}
    </td>
  );

  const resultRow = (label: string, help: HelpKey | null, pick: (r: Results) => number | null, red = false, skipYear = false) => (
    <tr>
      <th scope="row">{label}{help && <Help lang={lang} topic={help} />}</th>
      {columns.map((c) => <td key={c.key} className="mn-st-pct">{pctText(pick(st.results[c.key]), lang, red)}</td>)}
      <td className="mn-st-pct mn-st-year">{skipYear ? "" : pctText(pick(st.totalResults), lang, red)}</td>
    </tr>
  );

  // Bank check: typed month-end balance vs previous typed balance + money that moved this month.
  const bankRows = mode === "monthly" && (
    <>
      <tr className="mn-st-section"><th scope="rowgroup" colSpan={columns.length + 2}>{mt(lang, "bankCheck")} <Help lang={lang} topic="bankCheck" /></th></tr>
      <tr>
        <th scope="row">{mt(lang, "bankBalance")}</th>
        {months.map((m) => <td key={m.key}><BalanceInput lang={lang} value={balances.get(m.key) ?? null} disabled={locks.has(m.key)} onSave={(cents) => onBalance(m.key, cents)} /></td>)}
        <td className="mn-st-year" />
      </tr>
      <tr>
        <th scope="row">{mt(lang, "loggedMoved")}</th>
        {months.map((m) => <td key={m.key}><Amount cents={cashNet(entries, m)} lang={lang} /></td>)}
        <td className="mn-st-year" />
      </tr>
      <tr>
        <th scope="row">{mt(lang, "expectedBalance")}</th>
        {months.map((m) => { const prev = balances.get(addMonths(m.start, -1, 1).slice(0, 7)); return <td key={m.key}>{prev === undefined ? <span className="mn-st-zero">—</span> : <Amount cents={prev + cashNet(entries, m)} lang={lang} tone="plain" />}</td>; })}
        <td className="mn-st-year" />
      </tr>
      <tr>
        <th scope="row">{mt(lang, "difference")}</th>
        {months.map((m) => {
          const prev = balances.get(addMonths(m.start, -1, 1).slice(0, 7));
          const typed = balances.get(m.key);
          if (prev === undefined || typed === undefined) return <td key={m.key}><span className="mn-st-zero">—</span></td>;
          const diff = typed - (prev + cashNet(entries, m));
          return <td key={m.key}>{diff === 0 ? <span className="mn-ok-badge">{mt(lang, "matches")}</span> : <span className="mn-diff-badge" title={lang === "fr" ? "La banque montre ce montant de plus (+) ou de moins (−) que ce qui est inscrit." : "The bank shows this much more (+) or less (−) than what's logged."}>{formatMoney(diff, lang, { sign: true })}</span>}</td>;
        })}
        <td className="mn-st-year" />
      </tr>
    </>
  );

  return (
    <section className="mn-statement">
      <div className="mn-section-head">
        <div>
          <h2>{mode === "monthly" ? mt(lang, "monthly") : mt(lang, "quarterly")} <Help lang={lang} topic="statement" /></h2>
          <p className="mn-muted">{formatDate(range.start, lang)} – {formatDate(range.end, lang)}</p>
        </div>
        <div className="mn-year-pick" role="group" aria-label={mt(lang, "year")}>
          <button type="button" className="mn-icon-button" aria-label={lang === "fr" ? "Année précédente" : "Previous year"} disabled={year <= firstYear} onClick={() => setYear((y) => y - 1)}><ChevronLeft size={18} /></button>
          <select className="mn-select" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={mt(lang, "year")}>
            {Array.from({ length: Math.max(todayYear + 1, year) - Math.min(firstYear, year) + 1 }, (_, i) => Math.min(firstYear, year) + i).map((y) => <option key={y} value={y}>{fiscalYearLabel(fiscalYearByStartYear(y, startMonth))}</option>)}
          </select>
          <button type="button" className="mn-icon-button" aria-label={lang === "fr" ? "Année suivante" : "Next year"} disabled={year >= todayYear + 1} onClick={() => setYear((y) => y + 1)}><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="mn-st-scroll">
        <table className={`mn-st mn-st-${mode}`}>
          <thead>
            <tr>
              <th scope="col" className="mn-st-corner">{lang === "fr" ? "Poste" : "Item"}</th>
              {columns.map((c) => (
                <th scope="col" key={c.key} className={mode === "monthly" && focusMonth === c.key ? "mn-st-focus" : ""}>
                  <span>{colLabel(c)}</span>
                  {mode === "monthly" && (
                    locks.has(c.key)
                      ? <button type="button" className="mn-lock mn-lock-on" title={mt(lang, "reopenMonth")} aria-label={`${mt(lang, "reopenMonth")} ${colLabel(c)}`} onClick={() => onReopenMonth(c.key)}><Lock size={12} /></button>
                      : <button type="button" className="mn-lock" title={mt(lang, "closeMonth")} aria-label={`${mt(lang, "closeMonth")} ${colLabel(c)}`} onClick={() => onCloseMonth(c.key)}><LockOpen size={12} /></button>
                  )}
                </th>
              ))}
              <th scope="col" className="mn-st-year">{mt(lang, "year")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="mn-st-section"><th scope="rowgroup" colSpan={columns.length + 2}>{mt(lang, "income")}</th></tr>
            {income.map((c) => (
              <tr key={c.id}>
                <th scope="row"><CategoryIcon name={c.icon} size={14} /> {name(c)}</th>
                {columns.map((col) => money(st.cells[col.key].byCategory[c.id] ?? 0, () => openDrill(`${name(c)} · ${colLabel(col)}`, (e) => e.categoryId === c.id, col.start, col.end), "in", false, col.key))}
                {money(st.total.byCategory[c.id] ?? 0, () => openDrill(`${name(c)} · ${fiscalYearLabel(range)}`, (e) => e.categoryId === c.id, range.start, range.end), "in", true)}
              </tr>
            ))}
            <tr className="mn-st-total">
              <th scope="row">{mt(lang, "totalIncome")}</th>
              {columns.map((col) => money(st.cells[col.key].incomeCents, () => openDrill(`${mt(lang, "totalIncome")} · ${colLabel(col)}`, (e) => e.kind === "in", col.start, col.end), "in", true, col.key))}
              {money(st.total.incomeCents, () => openDrill(`${mt(lang, "totalIncome")} · ${fiscalYearLabel(range)}`, (e) => e.kind === "in", range.start, range.end), "in", true)}
            </tr>
            <tr className="mn-st-section"><th scope="rowgroup" colSpan={columns.length + 2}>{mt(lang, "expenses")}</th></tr>
            {expenses.map((c) => (
              <tr key={c.id}>
                <th scope="row"><CategoryIcon name={c.icon} size={14} /> {name(c)}</th>
                {columns.map((col) => money(st.cells[col.key].byCategory[c.id] ?? 0, () => openDrill(`${name(c)} · ${colLabel(col)}`, (e) => e.categoryId === c.id, col.start, col.end), "out", false, col.key))}
                {money(st.total.byCategory[c.id] ?? 0, () => openDrill(`${name(c)} · ${fiscalYearLabel(range)}`, (e) => e.categoryId === c.id, range.start, range.end), "out", true)}
              </tr>
            ))}
            <tr className="mn-st-total">
              <th scope="row">{mt(lang, "totalExpenses")}</th>
              {columns.map((col) => money(st.cells[col.key].expenseCents, () => openDrill(`${mt(lang, "totalExpenses")} · ${colLabel(col)}`, (e) => e.kind === "out", col.start, col.end), "out", true, col.key))}
              {money(st.total.expenseCents, () => openDrill(`${mt(lang, "totalExpenses")} · ${fiscalYearLabel(range)}`, (e) => e.kind === "out", range.start, range.end), "out", true)}
            </tr>
            <tr className="mn-st-section"><th scope="rowgroup" colSpan={columns.length + 2}>{mt(lang, "resultsTitle")}</th></tr>
            <tr className="mn-st-total mn-st-profit">
              <th scope="row">{mt(lang, "profit")} <Help lang={lang} topic="kept" /></th>
              {columns.map((col) => money(st.cells[col.key].profitCents, () => openDrill(`${mt(lang, "kept")} · ${colLabel(col)}`, () => true, col.start, col.end), "auto", true, col.key))}
              {money(st.total.profitCents, () => openDrill(`${mt(lang, "kept")} · ${fiscalYearLabel(range)}`, () => true, range.start, range.end), "auto", true)}
            </tr>
            {resultRow(mt(lang, "profitMarginRow"), "margin", (r) => r.profitMargin, true)}
            {resultRow(mt(lang, "partsMargin"), "partsMargin", (r) => r.partsMargin, true)}
            {resultRow(mt(lang, "expensesShare"), "expensesShare", (r) => r.expensesShare)}
            {resultRow(mode === "monthly" ? mt(lang, "growthMonth") : mt(lang, "growthQuarter"), "growth", (r) => r.incomeGrowth, true, true)}
            {bankRows}
          </tbody>
        </table>
      </div>
      {mode === "monthly" && <p className="mn-muted mn-st-legend"><Lock size={12} /> {mt(lang, "closeMonth")} / {mt(lang, "reopenMonth")} <Help lang={lang} topic="monthLock" /></p>}

      {drill && (
        <Sheet title={drill.title} onClose={() => setDrill(null)} wide>
          <p className="mn-muted">{mt(lang, "entriesBehind")} · {drill.entries.length} · <Amount cents={drill.totalCents} lang={lang} /> {lang === "fr" ? "avant taxes" : "before taxes"}</p>
          {!drill.entries.length ? <p className="mn-muted">—</p> : (
            <ul className="mn-plain-list mn-drill">
              {drill.entries.map((e) => {
                const c = categories.find((x) => x.id === e.categoryId);
                return (
                  <li key={e.id}>
                    <button type="button" className="mn-row-main" onClick={() => { setDrill(null); onOpenEntry(e); }}>
                      <span className={`mn-row-icon mn-row-icon-${e.kind}`}><CategoryIcon name={c?.icon ?? "receipt"} /></span>
                      <span className="mn-row-text"><b>{e.party || (c ? name(c) : "—")}</b><small>{formatDate(e.date, lang)}{e.description ? ` · ${e.description}` : ""}</small></span>
                      <span className="mn-row-amount"><Amount cents={e.kind === "in" ? e.netCents : -e.netCents} lang={lang} tone={e.kind} /><small>{formatMoney(e.totalCents, lang)} {lang === "fr" ? "taxes incl." : "with tax"}</small></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Sheet>
      )}
    </section>
  );
}

function pctText(value: number | null, lang: Lang, red: boolean) {
  if (value === null) return "—";
  return <span className={red && value < 0 ? "mn-out" : ""}>{formatPercent(value, lang)}</span>;
}

function BalanceInput({ lang, value, disabled, onSave }: { lang: Lang; value: Cents | null; disabled: boolean; onSave: (cents: Cents) => void }) {
  const [text, setText] = useState(value === null ? "" : centsToInput(value, lang));
  const [bad, setBad] = useState(false);
  const commit = () => {
    if (!text.trim()) { setBad(false); return; }
    const cents = parseMoney(text);
    if (cents === null) { setBad(true); return; }
    setBad(false);
    if (cents !== value) onSave(cents);
  };
  return <input className={`mn-bank-input ${bad ? "mn-bank-bad" : ""}`} inputMode="decimal" placeholder={mt(lang, "typeBalance")} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-invalid={bad} />;
}
