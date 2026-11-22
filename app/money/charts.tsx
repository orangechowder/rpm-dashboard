"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatMoneyShort, formatPercent, type Cents, type Lang } from "../../lib/money/cents";
import { mt, type HelpKey } from "./i18n";
import { Help } from "./ui";

/** Chart colours, chosen per theme (SVG attributes can't read CSS variables reliably). */
export type ChartTheme = {
  green: string; hatch: string; hatchBg: string; dot: string; line: string; grid: string; axis: string; text: string; surface: string; categorical: string[]; other: string;
};
const LIGHT: ChartTheme = {
  green: "#0a7f3f", hatch: "#8d99a6", hatchBg: "#e6eaef", dot: "#fbbf24", line: "#182230", grid: "#e3e7ec", axis: "#182230", text: "#526174", surface: "#ffffff",
  // Validated categorical order (dataviz reference palette, light); "Other" is a hatched neutral.
  categorical: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6", "#e34948"], other: "#8a8f98",
};
const DARK: ChartTheme = {
  green: "#2fbf6b", hatch: "#7b8794", hatchBg: "#1d2430", dot: "#fcd34d", line: "#edf2f7", grid: "#222a36", axis: "#a3afc2", text: "#a3afc2", surface: "#0D111A",
  categorical: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e66767"], other: "#7d838c",
};

export function useChartTheme(): ChartTheme {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => setDark(document.documentElement.getAttribute("data-theme") === "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return dark ? DARK : LIGHT;
}

function Hatch({ id, theme }: { id: string; theme: ChartTheme }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill={theme.hatchBg} />
      <line x1="0" y1="0" x2="0" y2="6" stroke={theme.hatch} strokeWidth="2" />
    </pattern>
  );
}

export function ChartCard({ title, sub, help, lang, children, table, height = 300, actions }: { title: string; sub?: string; help: HelpKey; lang: Lang; children: ReactNode; table: ReactNode; height?: number; actions?: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="mn-card mn-chart-card">
      <div className="mn-chart-head">
        <div>
          <h3>{title} <Help lang={lang} topic={help} label={title} /></h3>
          {sub && <p className="mn-card-sub">{sub}</p>}
        </div>
        <div className="mn-chart-actions">
          {actions}
          <button type="button" className="mn-link" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>{showTable ? (lang === "fr" ? "Graphique" : "Chart") : (lang === "fr" ? "Tableau" : "Table")}</button>
        </div>
      </div>
      {showTable ? <div className="mn-chart-table">{table}</div> : <div className="mn-chart-box" style={{ height }}>{children}</div>}
    </section>
  );
}

function Legend({ items }: { items: Array<{ label: string; swatch: ReactNode }> }) {
  return <ul className="mn-legend">{items.map((item) => <li key={item.label}>{item.swatch}<span>{item.label}</span></li>)}</ul>;
}

function TooltipBox({ title, rows }: { title: string; rows: Array<{ label: string; value: string; strong?: boolean }> }) {
  return (
    <div className="mn-tooltip">
      <b>{title}</b>
      {rows.map((row) => <div key={row.label} className={row.strong ? "mn-tooltip-strong" : ""}><span>{row.label}</span><span>{row.value}</span></div>)}
    </div>
  );
}

const axisProps = (theme: ChartTheme) => ({ tick: { fill: theme.text, fontSize: 12 }, tickLine: false, axisLine: false });

/** Wave-style two-line month tick: "Nov" over "'26". */
function MonthTick({ x, y, payload, fill }: { x?: number; y?: number; payload?: { value: string }; fill: string }) {
  const [month, year] = String(payload?.value ?? "").split(" ");
  return (
    <text x={x} y={y} textAnchor="middle" fill={fill} fontSize={11}>
      <tspan x={x} dy="0.9em">{month}</tspan>
      <tspan x={x} dy="1.2em">{year}</tspan>
    </text>
  );
}

export type MonthPoint = { key: string; label: string; inCents: Cents; outCents: Cents; netCents: Cents };

/** a) Cash flow — green inflow bars up, grey hatched outflow bars down, net line with yellow dots. */
export function CashFlowChart({ data, lang, theme }: { data: MonthPoint[]; lang: Lang; theme: ChartTheme }) {
  const rows = data.map((d) => ({ ...d, inflow: d.inCents / 100, outflow: -d.outCents / 100, net: d.netCents / 100 }));
  return (
    <>
      <Legend items={[
        { label: mt(lang, "inflow"), swatch: <span className="mn-swatch" style={{ background: theme.green }} /> },
        { label: mt(lang, "outflow"), swatch: <svg width="16" height="16" className="mn-swatch-svg" aria-hidden="true"><defs><Hatch id="mn-h-leg" theme={theme} /></defs><rect width="16" height="16" rx="4" fill="url(#mn-h-leg)" stroke={theme.hatch} /></svg> },
        { label: mt(lang, "netChange"), swatch: <svg width="22" height="12" aria-hidden="true"><line x1="0" y1="6" x2="22" y2="6" stroke={theme.line} strokeWidth="2" /><circle cx="11" cy="6" r="4.5" fill={theme.dot} stroke={theme.line} strokeWidth="1.5" /></svg> },
      ]} />
      <ResponsiveContainer width="100%" height="85%">
        <ComposedChart data={rows} margin={{ top: 10, right: 8, left: 4, bottom: 0 }} stackOffset="sign" barCategoryGap="28%">
          <defs><Hatch id="mn-h-cash" theme={theme} /></defs>
          <CartesianGrid vertical={false} stroke={theme.grid} />
          <XAxis dataKey="label" {...axisProps(theme)} interval={0} height={36} tick={(props: object) => <MonthTick {...props} fill={theme.text} />} />
          <YAxis {...axisProps(theme)} width={62} tickFormatter={(v: number) => formatMoneyShort(Math.round(v * 100), lang)} />
          <ReferenceLine y={0} stroke={theme.axis} strokeWidth={1.2} />
          <Tooltip cursor={{ fill: theme.grid, opacity: 0.5 }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as MonthPoint;
            return <TooltipBox title={p.label} rows={[{ label: mt(lang, "inflow"), value: formatMoney(p.inCents, lang) }, { label: mt(lang, "outflow"), value: formatMoney(p.outCents, lang) }, { label: mt(lang, "netChange"), value: formatMoney(p.netCents, lang, { sign: true }), strong: true }]} />;
          }} />
          <Bar dataKey="inflow" stackId="cash" fill={theme.green} radius={[4, 4, 0, 0]} maxBarSize={20} isAnimationActive={false} />
          <Bar dataKey="outflow" stackId="cash" fill="url(#mn-h-cash)" stroke={theme.hatch} strokeWidth={1} radius={[0, 0, 4, 4]} maxBarSize={20} isAnimationActive={false} />
          <Line dataKey="net" stroke={theme.line} strokeWidth={1.5} dot={{ r: 4.5, fill: theme.dot, stroke: theme.line, strokeWidth: 1.5 }} activeDot={{ r: 6, fill: theme.dot, stroke: theme.line }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}

/** b) Money in vs money out by month — like Wave's Profit and loss card. */
export function InOutChart({ data, lang, theme }: { data: MonthPoint[]; lang: Lang; theme: ChartTheme }) {
  const rows = data.map((d) => ({ ...d, income: d.inCents / 100, expense: d.outCents / 100 }));
  return (
    <>
      <Legend items={[
        { label: mt(lang, "moneyIn"), swatch: <span className="mn-swatch" style={{ background: theme.green }} /> },
        { label: mt(lang, "moneyOut"), swatch: <svg width="16" height="16" className="mn-swatch-svg" aria-hidden="true"><defs><Hatch id="mn-h-leg2" theme={theme} /></defs><rect width="16" height="16" rx="4" fill="url(#mn-h-leg2)" stroke={theme.hatch} /></svg> },
      ]} />
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={rows} margin={{ top: 10, right: 8, left: 4, bottom: 0 }} barGap={2} barCategoryGap="24%">
          <defs><Hatch id="mn-h-pl" theme={theme} /></defs>
          <CartesianGrid vertical={false} stroke={theme.grid} />
          <XAxis dataKey="label" {...axisProps(theme)} interval={0} height={36} tick={(props: object) => <MonthTick {...props} fill={theme.text} />} />
          <YAxis {...axisProps(theme)} width={62} tickFormatter={(v: number) => formatMoneyShort(Math.round(v * 100), lang)} />
          <ReferenceLine y={0} stroke={theme.axis} strokeWidth={1.2} />
          <Tooltip cursor={{ fill: theme.grid, opacity: 0.5 }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as MonthPoint;
            return <TooltipBox title={p.label} rows={[{ label: mt(lang, "moneyIn"), value: formatMoney(p.inCents, lang) }, { label: mt(lang, "moneyOut"), value: formatMoney(p.outCents, lang) }, { label: mt(lang, "kept"), value: formatMoney(p.inCents - p.outCents, lang, { sign: true }), strong: true }]} />;
          }} />
          <Bar dataKey="income" fill={theme.green} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
          <Bar dataKey="expense" fill="url(#mn-h-pl)" stroke={theme.hatch} strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

export type YearCompare = { previous: { in: Cents; out: Cents }; current: { in: Cents; out: Cents }; previousLabel: string; currentLabel: string };

/** c) This year vs last year — two bars of what was kept, and the small table under it. */
export function YearCompareChart({ data, lang, theme }: { data: YearCompare; lang: Lang; theme: ChartTheme }) {
  const rows = [
    { name: `${mt(lang, "previous")} (${data.previousLabel})`, kept: (data.previous.in - data.previous.out) / 100, cents: data.previous.in - data.previous.out },
    { name: `${mt(lang, "current")} (${data.currentLabel})`, kept: (data.current.in - data.current.out) / 100, cents: data.current.in - data.current.out },
  ];
  return (
    <div className="mn-year">
      <div className="mn-year-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 10, right: 8, left: 4, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="name" {...axisProps(theme)} tick={{ fill: theme.text, fontSize: 12 }} />
            <YAxis {...axisProps(theme)} width={62} tickFormatter={(v: number) => formatMoneyShort(Math.round(v * 100), lang)} />
            <ReferenceLine y={0} stroke={theme.axis} strokeWidth={1.2} />
            <Tooltip cursor={{ fill: theme.grid, opacity: 0.5 }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { name: string; cents: Cents };
              return <TooltipBox title={p.name} rows={[{ label: mt(lang, "kept"), value: formatMoney(p.cents, lang), strong: true }]} />;
            }} />
            <Bar dataKey="kept" radius={[4, 4, 0, 0]} maxBarSize={120} isAnimationActive={false}>
              {rows.map((row) => <Cell key={row.name} fill={row.cents < 0 ? "#c62839" : theme.green} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <YearTable data={data} lang={lang} />
    </div>
  );
}

export function YearTable({ data, lang }: { data: YearCompare; lang: Lang }) {
  const line = (label: string, a: Cents, b: Cents, strong = false) => (
    <tr className={strong ? "mn-strong-row" : ""}><th scope="row">{label}</th><td>{formatMoney(a, lang)}</td><td>{formatMoney(b, lang)}</td></tr>
  );
  return (
    <table className="mn-mini-table">
      <thead><tr><th /><th scope="col">{mt(lang, "previous")}</th><th scope="col">{mt(lang, "current")}</th></tr></thead>
      <tbody>
        {line(mt(lang, "moneyIn"), data.previous.in, data.current.in)}
        {line(mt(lang, "moneyOut"), data.previous.out, data.current.out)}
        {line(mt(lang, "kept"), data.previous.in - data.previous.out, data.current.in - data.current.out, true)}
      </tbody>
    </table>
  );
}

export type Slice = { id: string; label: string; cents: Cents };

/** Top 7 categories keep their colour; the rest fold into a hatched "Other" (never an 8th generated hue). */
export function foldSlices(slices: Slice[], lang: Lang): Slice[] {
  const sorted = slices.filter((s) => s.cents > 0).sort((a, b) => b.cents - a.cents);
  if (sorted.length <= 8) return sorted;
  const rest = sorted.slice(7).reduce((sum, s) => sum + s.cents, 0);
  return [...sorted.slice(0, 7), { id: "__other", label: lang === "fr" ? "Autres" : "Other", cents: rest }];
}

/** d) Where the money goes — donut + legend with %. */
export function DonutChart({ slices, lang, theme }: { slices: Slice[]; lang: Lang; theme: ChartTheme }) {
  const total = slices.reduce((s, x) => s + x.cents, 0);
  const colour = (slice: Slice, index: number) => (slice.id === "__other" ? "url(#mn-h-other)" : theme.categorical[index % theme.categorical.length]);
  return (
    <div className="mn-donut">
      <ul className="mn-donut-legend">
        {slices.map((slice, index) => (
          <li key={slice.id}>
            {slice.id === "__other"
              ? <svg width="14" height="14" aria-hidden="true"><defs><pattern id={`mn-h-o-${index}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill={theme.hatchBg} /><line x1="0" y1="0" x2="0" y2="5" stroke={theme.other} strokeWidth="2" /></pattern></defs><rect width="14" height="14" rx="3" fill={`url(#mn-h-o-${index})`} /></svg>
              : <span className="mn-swatch" style={{ background: theme.categorical[index] }} />}
            <span className="mn-donut-pct">{formatPercent(total ? slice.cents / total : null, lang, { digits: 0 })}</span>
            <span className="mn-donut-label">{slice.label}</span>
            <span className="mn-donut-amt">{formatMoney(slice.cents, lang, { whole: true })}</span>
          </li>
        ))}
      </ul>
      <div className="mn-donut-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              <pattern id="mn-h-other" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill={theme.hatchBg} /><line x1="0" y1="0" x2="0" y2="6" stroke={theme.other} strokeWidth="2" /></pattern>
            </defs>
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Slice;
              return <TooltipBox title={p.label} rows={[{ label: formatPercent(total ? p.cents / total : null, lang), value: formatMoney(p.cents, lang), strong: true }]} />;
            }} />
            <Pie data={slices} dataKey="cents" nameKey="label" innerRadius="58%" outerRadius="92%" paddingAngle={slices.length > 1 ? 1.2 : 0} stroke={theme.surface} strokeWidth={2} isAnimationActive={false}>
              {slices.map((slice, index) => <Cell key={slice.id} fill={colour(slice, index)} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** e) Top 10 clients — horizontal bars, one colour (it's one measure), names on the axis. */
export function TopClientsChart({ rows, lang, theme }: { rows: Array<{ party: string; cents: Cents; count: number }>; lang: Lang; theme: ChartTheme }) {
  const data = rows.map((r) => ({ ...r, value: r.cents / 100 }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 70, left: 4, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid horizontal={false} stroke={theme.grid} />
        <XAxis type="number" {...axisProps(theme)} tickFormatter={(v: number) => formatMoneyShort(Math.round(v * 100), lang)} />
        <YAxis type="category" dataKey="party" {...axisProps(theme)} width={150} tick={{ fill: theme.text, fontSize: 12 }} tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)} />
        <Tooltip cursor={{ fill: theme.grid, opacity: 0.5 }} content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const p = payload[0].payload as { party: string; cents: Cents; count: number };
          return <TooltipBox title={p.party} rows={[{ label: lang === "fr" ? `${p.count} entrée(s)` : `${p.count} entr${p.count === 1 ? "y" : "ies"}`, value: formatMoney(p.cents, lang), strong: true }]} />;
        }} />
        <Bar dataKey="value" fill={theme.green} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} label={{ position: "right", fill: theme.text, fontSize: 11, formatter: (v: unknown) => formatMoneyShort(Math.round(Number(v) * 100), lang) }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MonthTable({ data, lang }: { data: MonthPoint[]; lang: Lang }) {
  return (
    <table className="mn-mini-table">
      <thead><tr><th scope="col">{lang === "fr" ? "Mois" : "Month"}</th><th scope="col">{mt(lang, "moneyIn")}</th><th scope="col">{mt(lang, "moneyOut")}</th><th scope="col">{mt(lang, "netChange")}</th></tr></thead>
      <tbody>{data.map((d) => <tr key={d.key}><th scope="row">{d.label}</th><td>{formatMoney(d.inCents, lang)}</td><td>{formatMoney(d.outCents, lang)}</td><td>{formatMoney(d.netCents, lang, { sign: true })}</td></tr>)}</tbody>
    </table>
  );
}
