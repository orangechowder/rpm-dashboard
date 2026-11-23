"use client";
import { waveAttentionText, type WaveAttention } from "./wave-panel";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarClock, CircleCheck, Paperclip, Receipt, TriangleAlert } from "lucide-react";
import { formatMoney, formatPercent, type Cents, type Lang } from "../../lib/money/cents";
import { TECHNICIAN_WAGES_ID } from "../../lib/money/categories";
import { addMonths, formatDate, monthEnd, monthStart, todayISO } from "../../lib/money/dates";
import { monthTitle, needsAttention, realProfit, summarySentence, type AttentionItem, type RealProfit } from "../../lib/money/insights";
import { fiscalYearLabel, fiscalYearRange, monthsIn, presetRange, previousRange, sameRangeLastYear, type PeriodPreset } from "../../lib/money/periods";
import type { RecurringRule } from "../../lib/money/recurring";
import { loadTimesheetDays } from "../../lib/money/repository";
import { cashFlow, change, summarize, topParties } from "../../lib/money/summary";
import type { DateRange, MoneyCategory, MoneyEntry, MoneySettings } from "../../lib/money/types";
import { CashFlowChart, ChartCard, DonutChart, foldSlices, InOutChart, MonthTable, TopClientsChart, useChartTheme, YearCompareChart, YearTable, type MonthPoint } from "./charts";
import { mt, type HelpKey } from "./i18n";
import { Amount, Empty, Help, Skeleton } from "./ui";

export type PeriodState = { preset: PeriodPreset; custom: DateRange };

export function OverviewTab({
  lang, entries, categories, settings, rules, loading, period, onPeriod, onOpenEntry, onMarkPaid, onGo, extraCards, waveItems = [], onWaveAction,
}: {
  lang: Lang;
  entries: MoneyEntry[];
  categories: MoneyCategory[];
  settings: MoneySettings;
  rules: RecurringRule[];
  loading: boolean;
  period: PeriodState;
  onPeriod: (p: PeriodState) => void;
  onOpenEntry: (entry: MoneyEntry) => void;
  onMarkPaid: (entry: MoneyEntry) => void;
  onGo: (tab: GoTarget, month?: string) => void;
  extraCards?: React.ReactNode;
  waveItems?: WaveAttention[];
  onWaveAction?: (item: WaveAttention, action: "add" | "ignore") => void;
}) {
  const theme = useChartTheme();
  const today = todayISO();
  const range = period.preset === "custom" ? period.custom : presetRange(period.preset, today, settings);
  const previous = previousRange(range);
  const current = useMemo(() => summarize(entries, range), [entries, range]);
  const before = useMemo(() => summarize(entries, previous), [entries, previous]);
  const marginNow = current.incomeCents ? current.profitCents / current.incomeCents : null;
  const marginBefore = before.incomeCents ? before.profitCents / before.incomeCents : null;
  const sentence = summarySentence(current, before, period.preset, categories, lang);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const live = entries.filter((e) => !e.deletedAt);

  // 12 months ending with the period's last month (like Wave's "Last 12 months").
  const months = monthsIn({ start: addMonths(monthStart(range.end), -11, 1), end: monthEnd(range.end) });
  const flow: MonthPoint[] = cashFlow(entries, months).map((p, i) => ({ key: p.key, label: months[i].label(lang), inCents: p.inflowCents, outCents: p.outflowCents, netCents: p.netCents }));
  const pl: MonthPoint[] = months.map((m) => { const s = summarize(entries, m); return { key: m.key, label: m.label(lang), inCents: s.incomeCents, outCents: s.expenseCents, netCents: s.profitCents }; });
  const fy = fiscalYearRange(range.end, settings.fiscalYearStartMonth);
  const ytd = { start: fy.start, end: range.end < fy.end ? range.end : fy.end };
  const lastYtd = sameRangeLastYear(ytd);
  const yCur = summarize(entries, ytd);
  const yPrev = summarize(entries, lastYtd);
  const yearData = { previous: { in: yPrev.incomeCents, out: yPrev.expenseCents }, current: { in: yCur.incomeCents, out: yCur.expenseCents }, previousLabel: fiscalYearLabel(fiscalYearRange(lastYtd.start, settings.fiscalYearStartMonth)), currentLabel: fiscalYearLabel(fy) };
  const slices = foldSlices(categories.filter((c) => c.kind === "out").map((c) => ({ id: c.id, label: lang === "fr" ? c.fr : c.en, cents: current.byCategory[c.id] ?? 0 })), lang);
  const top = topParties(entries, range, "in", 10).filter((p) => p.party !== "—");

  const [labour, setLabour] = useState<{ key: string; value: RealProfit | null; error: boolean } | null>(null);
  const labourKey = `${range.start}|${range.end}|${current.profitCents}|${current.byCategory[TECHNICIAN_WAGES_ID] ?? 0}`;
  useEffect(() => {
    let alive = true;
    loadTimesheetDays(range.start, range.end)
      .then((days) => { if (alive) setLabour({ key: labourKey, value: realProfit(current.profitCents, days, current.byCategory[TECHNICIAN_WAGES_ID] ?? 0), error: false }); })
      .catch(() => { if (alive) setLabour({ key: labourKey, value: null, error: true }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labourKey captures every input
  }, [labourKey]);
  const labourReady = labour?.key === labourKey ? labour : null;

  const attention = useMemo(() => needsAttention(entries, rules, categories, today), [entries, rules, categories, today]);

  const presets: Array<{ value: PeriodPreset; label: string }> = [
    { value: "thisMonth", label: mt(lang, "thisMonth") }, { value: "lastMonth", label: mt(lang, "lastMonth") }, { value: "thisQuarter", label: mt(lang, "thisQuarter") },
    { value: "thisYear", label: mt(lang, "thisYear") }, { value: "last12", label: mt(lang, "last12") }, { value: "custom", label: mt(lang, "custom") },
  ];

  return (
    <div className="mn-overview">
      <div className="mn-period">
        <div className="mn-chips mn-chips-scroll" role="radiogroup" aria-label={lang === "fr" ? "Période" : "Period"}>
          {presets.map((p) => (
            <button key={p.value} type="button" role="radio" aria-checked={period.preset === p.value} className={`mn-chip ${period.preset === p.value ? "mn-chip-on" : ""}`} onClick={() => onPeriod({ ...period, preset: p.value, custom: p.value === "custom" && period.preset !== "custom" ? range : period.custom })}>{p.label}</button>
          ))}
        </div>
        {period.preset === "custom" ? (
          <div className="mn-custom-range">
            <label>{mt(lang, "from")}<input type="date" value={period.custom.start} max={period.custom.end} onChange={(e) => e.target.value && onPeriod({ ...period, custom: { ...period.custom, start: e.target.value } })} /></label>
            <label>{mt(lang, "to")}<input type="date" value={period.custom.end} min={period.custom.start} onChange={(e) => e.target.value && onPeriod({ ...period, custom: { ...period.custom, end: e.target.value } })} /></label>
          </div>
        ) : <p className="mn-period-label">{formatDate(range.start, lang)} – {formatDate(range.end, lang)}</p>}
      </div>

      <div className="mn-cards">
        <BigCard lang={lang} title={mt(lang, "moneyIn")} help="moneyIn" loading={loading} value={<Amount cents={current.incomeCents} lang={lang} tone="in" />} delta={change(current.incomeCents, before.incomeCents)} goodWhenUp />
        <BigCard lang={lang} title={mt(lang, "moneyOut")} help="moneyOut" loading={loading} value={<Amount cents={current.expenseCents} lang={lang} tone="out" />} delta={change(current.expenseCents, before.expenseCents)} goodWhenUp={false} />
        <BigCard lang={lang} title={mt(lang, "kept")} help="kept" loading={loading} value={<Amount cents={current.profitCents} lang={lang} />} delta={change(current.profitCents, before.profitCents)} goodWhenUp />
        <BigCard lang={lang} title={mt(lang, "margin")} help="margin" loading={loading} value={<span className={`mn-amount ${marginNow !== null && marginNow < 0 ? "mn-out" : "mn-in"}`}>{formatPercent(marginNow, lang)}</span>} delta={marginNow !== null && marginBefore !== null ? marginNow - marginBefore : null} points goodWhenUp />
      </div>

      {loading ? <Skeleton height={22} width="70%" /> : <p className="mn-sentence">{sentence}</p>}

      <div className="mn-overview-grid">
        <Attention lang={lang} items={attention} byId={byId} onOpenEntry={onOpenEntry} onMarkPaid={onMarkPaid} onGo={onGo} waveItems={waveItems} onWaveAction={onWaveAction} />
        <RealProfitCard lang={lang} data={labourReady?.value ?? null} error={Boolean(labourReady?.error)} loading={loading || !labourReady} />
        {extraCards}
      </div>

      {!loading && !live.length ? <Empty title={mt(lang, "noEntries")} text={mt(lang, "noEntriesHelp")} /> : (
        <div className="mn-charts">
          <ChartCard lang={lang} title={mt(lang, "cashFlow")} sub={mt(lang, "cashFlowSub")} help="cashFlow" table={<MonthTable data={flow} lang={lang} />}>
            {loading ? <Skeleton height={260} /> : <CashFlowChart data={flow} lang={lang} theme={theme} />}
          </ChartCard>
          <ChartCard lang={lang} title={mt(lang, "inVsOut")} sub={mt(lang, "inVsOutSub")} help="inVsOut" table={<MonthTable data={pl} lang={lang} />}>
            {loading ? <Skeleton height={260} /> : <InOutChart data={pl} lang={lang} theme={theme} />}
          </ChartCard>
          <ChartCard lang={lang} title={mt(lang, "yearVsYear")} sub={`${mt(lang, "yearVsYearSub")} · ${formatDate(ytd.start, lang)} – ${formatDate(ytd.end, lang)}`} help="yearVsYear" height={380} table={<YearTable data={yearData} lang={lang} />}>
            {loading ? <Skeleton height={340} /> : <YearCompareChart data={yearData} lang={lang} theme={theme} />}
          </ChartCard>
          <ChartCard lang={lang} title={mt(lang, "whereMoneyGoes")} sub={`${formatDate(range.start, lang)} – ${formatDate(range.end, lang)}`} help="whereMoneyGoes" height={300}
            table={<table className="mn-mini-table"><tbody>{slices.map((s) => <tr key={s.id}><th scope="row">{s.label}</th><td>{formatMoney(s.cents, lang)}</td><td>{formatPercent(current.expenseCents ? s.cents / current.expenseCents : null, lang)}</td></tr>)}</tbody></table>}>
            {loading ? <Skeleton height={260} /> : slices.length ? <DonutChart slices={slices} lang={lang} theme={theme} /> : <p className="mn-muted mn-chart-empty">{lang === "fr" ? "Aucune dépense pour cette période." : "No money out in this period."}</p>}
          </ChartCard>
          <ChartCard lang={lang} title={mt(lang, "topClients")} sub={mt(lang, "topClientsSub")} help="topClients" height={Math.max(160, top.length * 34 + 40)}
            table={<table className="mn-mini-table"><tbody>{top.map((p) => <tr key={p.party}><th scope="row">{p.party}</th><td>{formatMoney(p.cents, lang)}</td><td>{p.count}</td></tr>)}</tbody></table>}>
            {loading ? <Skeleton height={200} /> : top.length ? <TopClientsChart rows={top} lang={lang} theme={theme} /> : <p className="mn-muted mn-chart-empty">{lang === "fr" ? "Aucun client inscrit pour cette période." : "No clients logged in this period."}</p>}
          </ChartCard>
        </div>
      )}
    </div>
  );
}

function BigCard({ lang, title, help, value, delta, goodWhenUp, points = false, loading }: { lang: Lang; title: string; help: HelpKey; value: React.ReactNode; delta: number | null; goodWhenUp: boolean; points?: boolean; loading: boolean }) {
  const up = delta !== null && delta > 0;
  const flat = delta === null || Math.abs(delta) < 0.0005;
  const good = flat ? null : up === goodWhenUp;
  const text = delta === null ? mt(lang, "noComparison") : points
    ? `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta * 100).toFixed(1).replace(".", lang === "fr" ? "," : ".")} ${lang === "fr" ? "pts" : "pts"}`
    : formatPercent(Math.abs(delta), lang, { digits: 0 });
  return (
    <section className="mn-big-card">
      <h3>{title} <Help lang={lang} topic={help} label={title} /></h3>
      <div className="mn-big-value">{loading ? <Skeleton height={34} width="70%" /> : value}</div>
      <p className={`mn-delta ${good === null ? "" : good ? "mn-delta-good" : "mn-delta-bad"}`}>
        {!flat && delta !== null && (up ? <ArrowUpRight size={15} aria-hidden="true" /> : <ArrowDownRight size={15} aria-hidden="true" />)}
        <span>{text}</span>
        <span className="mn-delta-vs">{mt(lang, "vsPrevious")} <Help lang={lang} topic="change" /></span>
      </p>
    </section>
  );
}

function RealProfitCard({ lang, data, loading, error }: { lang: Lang; data: RealProfit | null; loading: boolean; error: boolean }) {
  return (
    <section className="mn-card mn-real">
      <h3>{mt(lang, "realProfit")} <Help lang={lang} topic="realProfit" /></h3>
      {error ? <p className="mn-problem">{mt(lang, "errorGeneric")}</p> : loading || !data ? <><Skeleton height={34} width="60%" /><Skeleton height={60} /></> : (
        <>
          <div className="mn-big-value"><Amount cents={data.realProfitCents} lang={lang} /></div>
          <dl className="mn-breakdown">
            <div><dt>{mt(lang, "kept")}</dt><dd><Amount cents={data.keptCents} lang={lang} tone="plain" /></dd></div>
            <div><dt>− {mt(lang, "labourBillable")}</dt><dd><Amount cents={-data.billableLabourCents} lang={lang} tone={data.billableLabourCents ? "out" : "plain"} /></dd></div>
            <div><dt>− {mt(lang, "lostTime")} <Help lang={lang} topic="lostTime" /></dt><dd><Amount cents={-data.lostTimeCents} lang={lang} tone={data.lostTimeCents ? "out" : "plain"} /></dd></div>
            {data.addBackCents > 0 && <div><dt>+ {mt(lang, "wagesAlreadyLogged")}</dt><dd><Amount cents={data.addBackCents} lang={lang} tone="plain" /></dd></div>}
          </dl>
          {data.missingRates && <p className="mn-banner mn-banner-warn"><TriangleAlert size={15} aria-hidden="true" />{mt(lang, "ratesMissing")}</p>}
        </>
      )}
    </section>
  );
}

const PRIORITY: Record<AttentionItem["type"], number> = { unpaid: 0, "bill-due": 1, "unpaid-bill": 2, "quiet-month": 3, receipt: 4 };

export type GoTarget = "bills" | "monthly" | "import" | "log-receipts" | "settings";

function Attention({ lang, items: raw, byId, onOpenEntry, onMarkPaid, onGo, waveItems, onWaveAction }: { lang: Lang; items: AttentionItem[]; byId: Map<string, MoneyCategory>; onOpenEntry: (e: MoneyEntry) => void; onMarkPaid: (e: MoneyEntry) => void; onGo: (tab: GoTarget, month?: string) => void; waveItems: WaveAttention[]; onWaveAction?: (item: WaveAttention, action: "add" | "ignore") => void }) {
  const [all, setAll] = useState(false);
  const receipts = raw.filter((i) => i.type === "receipt");
  // Most important first; many missing receipts collapse into one line that opens the filtered list.
  const items = [...raw.filter((i) => i.type !== "receipt" || receipts.length <= 3)].sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type]);
  // Folded view: at most 3 of each kind, so one long list (e.g. unpaid invoices) can't hide the rest.
  const perType = new Map<string, number>();
  const folded = items.filter((item) => { const n = (perType.get(item.type) ?? 0) + 1; perType.set(item.type, n); return n <= 3; });
  const shown = all ? items : folded;
  const receiptSummary = receipts.length > 3;
  const name = (e: MoneyEntry) => e.party || (byId.get(e.categoryId)?.[lang === "fr" ? "fr" : "en"] ?? "—");
  return (
    <section className="mn-card mn-attention">
      <h3>{mt(lang, "needsAttention")} {raw.length + waveItems.length > 0 && <span className="mn-count">{raw.length + waveItems.length}</span>} <Help lang={lang} topic="needsAttention" /></h3>
      {!raw.length && !waveItems.length ? <p className="mn-all-good"><CircleCheck size={18} aria-hidden="true" />{mt(lang, "allGood")}</p> : (
        <ul className="mn-plain-list">
          {waveItems.map((item) => {
            const t = waveAttentionText(item, lang, (id) => byId.get(id)?.[lang === "fr" ? "fr" : "en"] ?? "");
            const fr = lang === "fr";
            return (
              <li key={`w${item.ref}`} className="mn-att-row mn-att-wave"><TriangleAlert size={16} className="mn-att-icon mn-att-warn" aria-hidden="true" />
                <span className="mn-att-text"><b>{t.title}</b><small>Wave · {t.detail}</small></span>
                <span className="mn-att-actions">
                  {item.kind === "unmatched" && <button type="button" className="mn-ghost" onClick={() => onWaveAction?.(item, "add")}>{fr ? "L'ajouter" : "Add it"}</button>}
                  {(item.kind === "unmapped" || item.kind === "connection") && <button type="button" className="mn-ghost" onClick={() => onGo("settings")}>{mt(lang, "open")}</button>}
                  {(item.kind === "closed-month" || item.kind === "gap") && <button type="button" className="mn-ghost" onClick={() => onGo("monthly", String(item.kind === "gap" ? item.title : ((item.details.after ?? item.details.before) as { date?: string } | null)?.date ?? "").slice(0, 7))}>{mt(lang, "open")}</button>}
                  {item.kind !== "connection" && item.kind !== "unmapped" && <button type="button" className="mn-link" onClick={() => onWaveAction?.(item, "ignore")}>{fr ? "Ignorer" : "Ignore"}</button>}
                </span></li>
            );
          })}
          {shown.map((item, index) => {
            if (item.type === "unpaid") return (
              <li key={`u${item.entry.id}`} className="mn-att-row"><TriangleAlert size={16} className="mn-att-icon mn-att-warn" aria-hidden="true" />
                <span className="mn-att-text"><b>{name(item.entry)}</b><small>{mt(lang, "unpaidOver30", { days: item.days })} · {formatMoney(item.entry.totalCents, lang)}</small></span>
                <button type="button" className="mn-ghost" onClick={() => onMarkPaid(item.entry)}>{mt(lang, "markPaid")}</button></li>
            );
            if (item.type === "unpaid-bill") return (
              <li key={`b${item.entry.id}`} className="mn-att-row"><Receipt size={16} className="mn-att-icon" aria-hidden="true" />
                <span className="mn-att-text"><b>{name(item.entry)}</b><small>{mt(lang, "unpaidBill")} · {formatDate(item.entry.date, lang)} · {formatMoney(item.entry.totalCents, lang)}</small></span>
                <button type="button" className="mn-ghost" onClick={() => onMarkPaid(item.entry)}>{mt(lang, "markPaid")}</button></li>
            );
            if (item.type === "receipt") return (
              <li key={`r${item.entry.id}`} className="mn-att-row"><Paperclip size={16} className="mn-att-icon" aria-hidden="true" />
                <span className="mn-att-text"><b>{name(item.entry)}</b><small>{mt(lang, "missingReceipt")} · {formatDate(item.entry.date, lang)} · {formatMoney(item.entry.totalCents, lang)}</small></span>
                <button type="button" className="mn-ghost" onClick={() => onOpenEntry(item.entry)}>{mt(lang, "addReceipt")}</button></li>
            );
            if (item.type === "bill-due") return (
              <li key={`d${item.rule.id}${index}`} className="mn-att-row"><CalendarClock size={16} className="mn-att-icon" aria-hidden="true" />
                <span className="mn-att-text"><b>{item.rule.name}</b><small>{mt(lang, "billDue", { date: formatDate(item.date, lang, { year: false }) })} · {formatMoney(item.rule.amountCents, lang)}</small></span>
                <button type="button" className="mn-ghost" onClick={() => onGo("bills")}>{mt(lang, "open")}</button></li>
            );
            return (
              <li key={`q${item.month}`} className="mn-att-row"><TriangleAlert size={16} className="mn-att-icon mn-att-warn" aria-hidden="true" />
                <span className="mn-att-text"><small>{mt(lang, "quietMonth", { month: monthTitle(item.month, lang), amount: formatMoney(item.expenseCents, lang, { whole: true }), typical: formatMoney(item.typicalCents, lang, { whole: true }) })}</small></span>
                <button type="button" className="mn-ghost" onClick={() => onGo("monthly", item.month)}>{mt(lang, "open")}</button></li>
            );
          })}
          {receiptSummary && (
            <li className="mn-att-row"><Paperclip size={16} className="mn-att-icon" aria-hidden="true" />
              <span className="mn-att-text"><b>{mt(lang, "missingReceipt")}</b><small>{lang === "fr" ? `${receipts.length} dépenses des 90 derniers jours n'ont pas de reçu` : `${receipts.length} expenses from the last 90 days have no receipt`}</small></span>
              <button type="button" className="mn-ghost" onClick={() => onGo("log-receipts")}>{mt(lang, "open")}</button></li>
          )}
        </ul>
      )}
      {items.length > folded.length && <button type="button" className="mn-link" onClick={() => setAll((v) => !v)}>{all ? (lang === "fr" ? "Voir moins" : "Show less") : (lang === "fr" ? `Voir les ${items.length}` : `Show all ${items.length}`)}</button>}
    </section>
  );
}

export function initialPeriod(): PeriodState {
  const today = todayISO();
  return { preset: "thisMonth", custom: { start: `${today.slice(0, 7)}-01`, end: today } };
}

export type { Cents };
