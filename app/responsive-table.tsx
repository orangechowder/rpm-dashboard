"use client";

import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";

export function ResponsiveTable({ className = "", children, ...props }: ComponentPropsWithoutRef<"table">) {
  const tableRef = useRef<HTMLTableElement>(null);

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const headers = Array.from(table.tHead?.rows[0]?.cells ?? [], (cell) => cell.textContent?.trim() || "Actions");
    table.tHead?.setAttribute("role", "rowgroup");
    for (const row of Array.from(table.tHead?.rows ?? [])) {
      row.setAttribute("role", "row");
      for (const cell of Array.from(row.cells)) cell.setAttribute("role", "columnheader");
    }
    for (const body of Array.from(table.tBodies)) {
      body.setAttribute("role", "rowgroup");
      for (const row of Array.from(body.rows)) {
        row.setAttribute("role", "row");
        let column = 0;
        for (const cell of Array.from(row.cells)) {
          cell.dataset.label = headers.slice(column, column + cell.colSpan).join(" / ");
          cell.dataset.mobileFull = String(cell.colSpan > 1);
          cell.setAttribute("role", "cell");
          column += cell.colSpan;
        }
      }
    }
  });

  return <table {...props} ref={tableRef} role="table" className={`responsive-table ${className}`}>{children}</table>;
}