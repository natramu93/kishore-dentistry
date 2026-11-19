import * as React from "react";

type WithChildren = { children?: React.ReactNode; colSpan?: number; "data-sort-value"?: string | number; "data-sort-fixed"?: boolean; "data-sort-id"?: string };
export type TableSortSnapshot = Record<string, { value: string; content: string }>;
export function tableNodes(children: React.ReactNode): React.ReactElement<WithChildren>[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement<WithChildren>(child)) return [];
    return child.type === React.Fragment ? tableNodes(child.props.children) : [child];
  });
}
export function tableText(children: React.ReactNode): string {
  return React.Children.toArray(children).map((child): string => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return React.isValidElement<WithChildren>(child) ? tableText(child.props.children) : "";
  }).join(" ").replace(/\s+/g, " ").trim();
}
function comparable(value: string | number): string | number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = value.trim();
  if (!text || text === "—" || text === "–") return null;
  if (/^[−-]?[₹]?[\d,]+(?:\.\d+)?$/.test(text)) return Number(text.replaceAll(",", "").replace("₹", "").replace("−", "-"));
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(text);
  if (time && Number(time[1]) >= 1 && Number(time[1]) <= 12 && Number(time[2]) < 60) {
    return ((Number(time[1]) % 12) + (time[4].toUpperCase() === "PM" ? 12 : 0)) * 3600 + Number(time[2]) * 60 + Number(time[3] ?? 0);
  }
  if (/^[A-Za-z]{3,9} \d{4}$/.test(text)) {
    const month = Date.parse(`1 ${text}`);
    if (Number.isFinite(month)) return month;
  }
  if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text) || /^\d{1,2} [A-Za-z]{3,9} \d{4}(?:,.*)?$/.test(text)) {
    const date = Date.parse(text);
    if (Number.isFinite(date)) return date;
  }
  return text;
}
export function identifiedTableRows(children: React.ReactNode) {
  return tableNodes(children).map((row, index) => React.cloneElement(row, { "data-sort-id": String(row.key ?? index) }));
}
export function sortedTableRows(children: React.ReactNode, column: number, descending: boolean, snapshot?: TableSortSnapshot): React.ReactNode {
  const rows = identifiedTableRows(children);
  const sortable = rows.filter((row) => !row.props["data-sort-fixed"] && !tableNodes(row.props.children).some((c) => (c.props.colSpan ?? 1) > 1));
  const sortableSet = new Set(sortable);
  const key = (row: React.ReactElement<WithChildren>) => {
    const cell = tableNodes(row.props.children)[column];
    const content = tableText(cell?.props.children);
    const saved = snapshot?.[row.props["data-sort-id"]!];
    return comparable(cell?.props["data-sort-value"] ?? (saved?.content === content ? saved.value : content));
  };
  const ordered = sortable.map((row, index) => ({ row, index, value: key(row) })).sort((a, b) => {
    if (a.value === null || b.value === null) return a.value === b.value ? a.index - b.index : a.value === null ? 1 : -1;
    const result = typeof a.value === "number" && typeof b.value === "number" ? a.value - b.value
      : String(a.value).localeCompare(String(b.value), "en-IN", { numeric: true, sensitivity: "base" });
    return (descending ? -result : result) || a.index - b.index;
  });
  let next = 0;
  return rows.map((row) => sortableSet.has(row) ? ordered[next++].row : row);
}
