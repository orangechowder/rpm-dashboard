"use client";

import { useMemo, useRef, useState } from "react";
import { Copy, Lock, Repeat, Search, Trash2 } from "lucide-react";
import { formatMoney, parseMoney, type Lang } from "../../lib/money/cents";
import { formatDate, monthKey, todayISO } from "../../lib/money/dates";
import type { MoneyCategory, MoneyEntry } from "../../lib/money/types";
import { mt } from "./i18n";
import { Amount, CategoryIcon, Empty, Skeleton } from "./ui";

export type Filter = "all" | "in" | "out" | "unpaid";

export function LogTab({
  lang, entries, categories, lockedMonths, loading, onEdit, onDelete, onDuplicateLast, initialFilter = "all",
}: {
  initialFilter?: Filter;
  lang: Lang;
  entries: MoneyEntry[];
  categories: MoneyCategory[];
  lockedMonths: Set<string>;
  loading: boolean;
  onEdit: (entry: MoneyEntry) => void;
  onDelete: (entry: MoneyEntry) => void;
  onDuplicateLast: (() => void) | null;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [days, setDays] = useState(45);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qCents = parseMoney(q);
    return entries.filter((entry) => {
      if (entry.deletedAt) return false;
      if (filter === "in" && entry.kind !== "in") return false;
      if (filter === "out" && entry.kind !== "out") return false;
      if (filter === "unpaid" && entry.paid) return false;
      if (categoryFilter && entry.categoryId !== categoryFilter) return false;
      if (q) {
        const category = byId.get(entry.categoryId);
        const hay = `${entry.party} ${entry.description} ${entry.receiptRef} ${category?.en ?? ""} ${category?.fr ?? ""}`.toLowerCase();
        const amountHit = qCents !== null && qCents > 0 && (entry.totalCents === qCents || entry.netCents === qCents);
        if (!hay.includes(q) && !amountHit) return false;
      }
      return true;
    });
  }, [entries, filter, categoryFilter, query, byId]);

  const groups = useMemo(() => {
    const map = new Map<string, MoneyEntry[]>();
    for (const entry of visible) map.set(entry.date, [...(map.get(entry.date) ?? []), entry]);
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible]);

  const shown = groups.slice(0, days);
  const today = todayISO();
  const filters: Array<{ value: Filter; label: string }> = [
    { value: "all", label: mt(lang, "all") },
    { value: "in", label: mt(lang, "moneyIn") },
    { value: "out", label: mt(lang, "moneyOut") },
    { value: "unpaid", label: mt(lang, "unpaid") },
  ];

  return (
    <section className="mn-log" aria-label={mt(lang, "tabLog")}>
      <div className="mn-log-tools">
        <label className="mn-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" placeholder={mt(lang, "search")} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={mt(lang, "search")} />
        </label>
        <div className="mn-chips mn-chips-scroll" role="radiogroup" aria-label="Filter">
          {filters.map((f) => (
            <button key={f.value} type="button" role="radio" aria-checked={filter === f.value} className={`mn-chip ${filter === f.value ? "mn-chip-on" : ""}`} onClick={() => setFilter(f.value)}>{f.label}</button>
          ))}
          <select className="mn-chip mn-chip-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label={mt(lang, "allCategories")}>
            <option value="">{mt(lang, "allCategories")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{lang === "fr" ? c.fr : c.en}</option>)}
          </select>
        </div>
        {onDuplicateLast && <button type="button" className="mn-ghost mn-dup-last" onClick={onDuplicateLast}><Copy size={15} />{mt(lang, "duplicateLast")}</button>}
      </div>

      {loading ? (
        <div className="mn-day">{[0, 1, 2, 3].map((i) => <div key={i} className="mn-row-skel"><Skeleton height={36} width={36} radius={10} /><Skeleton height={14} width="45%" /><Skeleton height={14} width={80} /></div>)}</div>
      ) : !entries.some((e) => !e.deletedAt) ? (
        <Empty title={mt(lang, "noEntries")} text={mt(lang, "noEntriesHelp")} />
      ) : !groups.length ? (
        <Empty title={mt(lang, "noMatches")} />
      ) : (
        <>
          {shown.map(([date, list]) => {
            const inCents = list.filter((e) => e.kind === "in").reduce((s, e) => s + e.netCents, 0);
            const outCents = list.filter((e) => e.kind === "out").reduce((s, e) => s + e.netCents, 0);
            return (
              <div className="mn-day" key={date}>
                <div className="mn-day-head">
                  <strong>{date === today ? (lang === "fr" ? "Aujourd'hui" : "Today") : formatDate(date, lang, { weekday: true, year: date.slice(0, 4) !== today.slice(0, 4) })}</strong>
                  <span className="mn-day-sums" title={lang === "fr" ? "Avant taxes" : "Before taxes"}>
                    {inCents > 0 && <span>{mt(lang, "dayIn")} <Amount cents={inCents} lang={lang} tone="in" /></span>}
                    {outCents > 0 && <span>{mt(lang, "dayOut")} <Amount cents={outCents} lang={lang} tone="out" /></span>}
                    <span>{mt(lang, "dayKept")} <Amount cents={inCents - outCents} lang={lang} /></span>
                  </span>
                </div>
                <ul className="mn-rows">
                  {list.map((entry) => (
                    <EntryRow key={entry.id} lang={lang} entry={entry} category={byId.get(entry.categoryId)} locked={lockedMonths.has(monthKey(entry.date))} onEdit={onEdit} onDelete={onDelete} />
                  ))}
                </ul>
              </div>
            );
          })}
          {groups.length > days && <button type="button" className="mn-ghost mn-more" onClick={() => setDays((d) => d + 60)}>{mt(lang, "showMore")}</button>}
        </>
      )}
    </section>
  );
}

/** One line. Tap to edit; swipe left (phone) to reveal Delete, or use the trash button (desktop). */
function EntryRow({ lang, entry, category, locked, onEdit, onDelete }: { lang: Lang; entry: MoneyEntry; category?: MoneyCategory; locked: boolean; onEdit: (e: MoneyEntry) => void; onDelete: (e: MoneyEntry) => void }) {
  const [dx, setDxState] = useState(0);
  const dxRef = useRef(0);
  const setDx = (value: number) => { dxRef.current = value; setDxState(value); };
  const start = useRef<{ x: number; y: number; dx: number } | null>(null);
  const swiping = useRef(false);
  const name = entry.party || (category ? (lang === "fr" ? category.fr : category.en) : "—");

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse" || locked) return;
    start.current = { x: event.clientX, y: event.clientY, dx: dxRef.current };
    swiping.current = false;
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!start.current) return;
    const mx = event.clientX - start.current.x;
    const my = event.clientY - start.current.y;
    if (!swiping.current && Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.5) swiping.current = true;
    if (swiping.current) setDx(Math.max(-140, Math.min(0, start.current.dx + mx)));
  };
  const onPointerUp = () => {
    if (!start.current) return;
    const wasSwiping = swiping.current;
    start.current = null;
    if (!wasSwiping) return;
    const moved = dxRef.current;
    if (moved < -120) { setDx(0); onDelete(entry); }
    else setDx(moved < -45 ? -88 : 0);
    window.setTimeout(() => { swiping.current = false; }, 0);
  };

  return (
    <li className="mn-row-wrap">
      <button type="button" className="mn-row-delete" tabIndex={dx ? 0 : -1} aria-hidden={!dx} onClick={() => { setDx(0); onDelete(entry); }}><Trash2 size={18} />{mt(lang, "delete")}</button>
      <div
        className="mn-row"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button type="button" className="mn-row-main" onClick={() => { if (swiping.current) return; if (dx) { setDx(0); return; } onEdit(entry); }}>
          <span className={`mn-row-icon mn-row-icon-${entry.kind}`}><CategoryIcon name={category?.icon ?? "receipt"} /></span>
          <span className="mn-row-text">
            <b>{name}</b>
            <small>
              {entry.party && category ? (lang === "fr" ? category.fr : category.en) : ""}
              {entry.description ? `${entry.party && category ? " · " : ""}${entry.description}` : ""}
            </small>
            <span className="mn-badges">
              {!entry.paid && <span className="mn-badge mn-badge-warn">{mt(lang, "unpaid")}</span>}
              {entry.receiptRef && <span className="mn-badge mn-badge-quiet" title={mt(lang, "receiptRef")}>{entry.receiptRef}</span>}
              {entry.source === "recurring" && <span className="mn-badge mn-badge-quiet" title={mt(lang, "recurringBadge")}><Repeat size={11} /></span>}
              {locked && <span className="mn-badge mn-badge-quiet" title={mt(lang, "closed")}><Lock size={11} /></span>}
            </span>
          </span>
          <span className="mn-row-amount">
            <Amount cents={entry.kind === "in" ? entry.totalCents : -entry.totalCents} lang={lang} tone={entry.kind} sign={entry.kind === "in"} />
            {entry.gstCents + entry.qstCents > 0 && <small>{formatMoney(entry.netCents, lang)} {lang === "fr" ? "avant taxes" : "before taxes"}</small>}
          </span>
        </button>
        {!locked && <button type="button" className="mn-row-trash" aria-label={mt(lang, "delete")} onClick={() => onDelete(entry)}><Trash2 size={15} /></button>}
      </div>
    </li>
  );
}
