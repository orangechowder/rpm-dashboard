"use client";

import { BellRing, CircleCheck } from "lucide-react";
import { formatMoney, type Cents, type Lang } from "../../lib/money/cents";
import { addDays, daysBetween, formatDate, todayISO, type ISODate } from "../../lib/money/dates";
import { fiscalYearRange, previousTaxPeriod, taxPeriodFor, type TaxPeriod } from "../../lib/money/periods";
import { summarize, taxesOwed, type Summary } from "../../lib/money/summary";
import type { MoneyEntry, MoneySettings } from "../../lib/money/types";
import { mt } from "./i18n";
import { Amount, Help } from "./ui";

export type Filings = Map<string, { filedOn: string; amountCents: Cents }>;
const keyOf = (p: { start: string; end: string }) => `${p.start}|${p.end}`;

export function periodName(p: { start: ISODate; end: ISODate }, lang: Lang) {
  const s = formatDate(p.start, lang, { year: p.start.slice(0, 4) !== p.end.slice(0, 4) });
  return `${s} – ${formatDate(p.end, lang)}`;
}

/** Periods that ended and aren't marked as sent, due within 30 days or already late (for the banner). */
export function taxReminders(entries: MoneyEntry[], settings: MoneySettings, filings: Filings, today = todayISO()) {
  const out: Array<{ period: TaxPeriod; owed: Cents; late: boolean }> = [];
  let p = previousTaxPeriod(taxPeriodFor(today, settings), settings);
  for (let i = 0; i < 6; i += 1) {
    if (!filings.has(keyOf(p))) {
      const s = summarize(entries, p);
      if (s.count > 0 && daysBetween(today, p.dueDate) <= 30) out.push({ period: p, owed: taxesOwed(s).totalCents, late: p.dueDate < today });
    }
    p = previousTaxPeriod(p, settings);
  }
  return out;
}

export function TaxReminderBanner({ lang, reminders, onOpen }: { lang: Lang; reminders: ReturnType<typeof taxReminders>; onOpen: () => void }) {
  if (!reminders.length) return null;
  const r = reminders[0];
  return (
    <p className={`mn-banner ${r.late ? "mn-banner-error" : "mn-banner-warn"}`} role="status">
      <BellRing size={16} aria-hidden="true" />
      <span>{mt(lang, r.late ? "taxDeadlineLate" : "taxDeadlineSoon", { period: periodName(r.period, lang), due: formatDate(r.period.dueDate, lang), amount: formatMoney(r.owed, lang) })}{reminders.length > 1 ? ` (+${reminders.length - 1})` : ""}</span>
      <button type="button" className="mn-link" onClick={onOpen}>{mt(lang, "open")}</button>
    </p>
  );
}

export function KeepAsideCard({ lang, entries, settings, filings }: { lang: Lang; entries: MoneyEntry[]; settings: MoneySettings; filings: Filings }) {
  const today = todayISO();
  const current = taxPeriodFor(today, settings);
  const owedNow = taxesOwed(summarize(entries, current)).totalCents;
  // Earlier periods not marked as sent are still owed too.
  let unsent = 0;
  let p = previousTaxPeriod(current, settings);
  for (let i = 0; i < 4; i += 1) {
    if (!filings.has(keyOf(p))) unsent += Math.max(0, taxesOwed(summarize(entries, p)).totalCents);
    p = previousTaxPeriod(p, settings);
  }
  const total = Math.max(0, owedNow) + unsent;
  return (
    <section className="mn-card mn-keep">
      <h3>{mt(lang, "taxesAside")} <Help lang={lang} topic="taxesAside" /></h3>
      <div className="mn-big-value"><Amount cents={total} lang={lang} tone={total > 0 ? "out" : "plain"} /></div>
      <p className="mn-muted">{mt(lang, "keepAsideSub", { period: periodName(current, lang), due: formatDate(current.dueDate, lang) })}{unsent > 0 ? (lang === "fr" ? ` · dont ${formatMoney(unsent, lang)} de périodes pas encore remises` : ` · includes ${formatMoney(unsent, lang)} from periods not sent yet`) : ""}</p>
    </section>
  );
}

export function TaxesTab({ lang, entries, settings, filings, onFile, onUnfile }: { lang: Lang; entries: MoneyEntry[]; settings: MoneySettings; filings: Filings; onFile: (p: TaxPeriod, owed: Cents) => void; onUnfile: (p: TaxPeriod) => void }) {
  const today = todayISO();
  const current = taxPeriodFor(today, settings);
  const s = summarize(entries, current);
  const owed = taxesOwed(s);
  // This fiscal year and last one, newest first.
  const start = fiscalYearRange(addDays(fiscalYearRange(today, settings.fiscalYearStartMonth).start, -1), settings.fiscalYearStartMonth).start;
  const periods: TaxPeriod[] = [];
  for (let p = current; p.start >= start && periods.length < 30; p = previousTaxPeriod(p, settings)) periods.push(p);
  const line = (label: string, cents: Cents, tone: "in" | "out" | "plain") => <div><dt>{label}</dt><dd><Amount cents={cents} lang={lang} tone={tone} /></dd></div>;

  return (
    <section className="mn-taxes">
      <div className="mn-taxes-top">
        <section className="mn-card mn-keep mn-keep-big">
          <h3>{mt(lang, "keepAside", { amount: formatMoney(Math.max(0, owed.totalCents), lang) })} <Help lang={lang} topic="taxesAside" /></h3>
          <p className="mn-muted">{mt(lang, "keepAsideSub", { period: periodName(current, lang), due: formatDate(current.dueDate, lang) })} <Help lang={lang} topic="deadline" /></p>
          <dl className="mn-breakdown">
            {line(mt(lang, "gstCollected"), s.gstCollectedCents, "plain")}
            {line(`− ${mt(lang, "gstPaid")}`, -s.gstPaidCents, "plain")}
            {line(mt(lang, "qstCollected"), s.qstCollectedCents, "plain")}
            {line(`− ${mt(lang, "qstPaid")}`, -s.qstPaidCents, "plain")}
            <div className="mn-breakdown-total"><dt>{owed.totalCents >= 0 ? mt(lang, "toSend") : mt(lang, "refund")}</dt><dd><Amount cents={Math.abs(owed.totalCents)} lang={lang} tone={owed.totalCents >= 0 ? "out" : "in"} /></dd></div>
          </dl>
        </section>
      </div>

      <div className="mn-section-head"><h2>{mt(lang, "period")}s <Help lang={lang} topic="taxPeriods" /></h2><span className="mn-muted">{mt(lang, "filingFrequency")}: {mt(lang, settings.taxFrequency === "monthly" ? "freqMonthly" : settings.taxFrequency === "quarterly" ? "freqQuarterly" : "freqYearly")}</span></div>
      <div className="mn-st-scroll">
        <table className="mn-mini-table mn-tax-table">
          <thead><tr><th scope="col">{mt(lang, "period")}</th><th scope="col">{mt(lang, "gstCollected")}</th><th scope="col">{mt(lang, "gstPaid")}</th><th scope="col">{mt(lang, "qstCollected")}</th><th scope="col">{mt(lang, "qstPaid")}</th><th scope="col">{mt(lang, "toSend")}</th><th scope="col">{mt(lang, "dueDate")}</th><th scope="col" /></tr></thead>
          <tbody>
            {periods.map((p) => {
              const ps = summarize(entries, p);
              const o = taxesOwed(ps).totalCents;
              const filed = filings.get(keyOf(p));
              const ended = p.end < today;
              const late = ended && !filed && p.dueDate < today;
              return (
                <tr key={keyOf(p)}>
                  <th scope="row">{periodName(p, lang)}{!ended && <span className="mn-badge">{lang === "fr" ? "en cours" : "in progress"}</span>}</th>
                  <td>{formatMoney(ps.gstCollectedCents, lang)}</td>
                  <td>{formatMoney(ps.gstPaidCents, lang)}</td>
                  <td>{formatMoney(ps.qstCollectedCents, lang)}</td>
                  <td>{formatMoney(ps.qstPaidCents, lang)}</td>
                  <td className={o < 0 ? "mn-in" : ""}><b>{formatMoney(o, lang)}</b></td>
                  <td className={late ? "mn-out" : ""}>{formatDate(p.dueDate, lang)}</td>
                  <td>
                    {filed
                      ? <span className="mn-filed"><CircleCheck size={14} aria-hidden="true" />{mt(lang, "filed")} <button type="button" className="mn-link" onClick={() => onUnfile(p)}>{mt(lang, "unfile")}</button></span>
                      : ended && <button type="button" className="mn-ghost" onClick={() => onFile(p, o)}>{mt(lang, "markFiled")}</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function emptySummary(): Summary { return summarize([], { start: "2000-01-01", end: "2000-01-01" }); }
