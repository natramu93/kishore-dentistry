"use client"

import * as React from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { identifiedTableRows, sortedTableRows, tableText, type TableSortSnapshot } from "@/lib/table-sort"

import { cn } from "@/lib/utils"

const SortContext = React.createContext<{
  sort: { column: number; descending: boolean; snapshot: TableSortSnapshot } | null;
  setSort: React.Dispatch<React.SetStateAction<{ column: number; descending: boolean; snapshot: TableSortSnapshot } | null>>;
  scope: string;
} | null>(null)

function Table({ className, sortable = true, sortScope = "displayed rows", ...props }: React.ComponentProps<"table"> & {
  sortable?: boolean; sortScope?: string;
}) {
  const [sort, setSort] = React.useState<{ column: number; descending: boolean; snapshot: TableSortSnapshot } | null>(null)
  const accessibleName = props["aria-label"]
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      role="region"
      aria-label={typeof accessibleName === "string" ? accessibleName : "Scrollable data table"}
      tabIndex={0}
    >
      <SortContext.Provider value={sortable ? { sort, setSort, scope: sortScope } : null}><table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      /></SortContext.Provider>
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, children, ...props }: React.ComponentProps<"tbody">) {
  const context = React.useContext(SortContext)
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    >{context?.sort ? sortedTableRows(children, context.sort.column, context.sort.descending, context.sort.snapshot)
      : context ? identifiedTableRows(children) : children}</tbody>
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr"> & { "data-sort-fixed"?: boolean }) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, children, sortable = true, ...props }: React.ComponentProps<"th"> & { sortable?: boolean }) {
  const context = React.useContext(SortContext)
  const [column, setColumn] = React.useState(-1)
  const ref = React.useCallback((node: HTMLTableCellElement | null) => {
    if (node) setColumn(node.cellIndex)
  }, [])
  const label = tableText(children)
  const enabled = context && sortable && label && label.toLowerCase() !== "actions" && !props.colSpan
  const active = enabled && context.sort?.column === column
  const Icon = active ? context.sort?.descending ? ArrowDown : ArrowUp : ArrowUpDown
  return (
    <th
      ref={ref}
      scope="col"
      aria-sort={enabled ? active ? context.sort?.descending ? "descending" : "ascending" : "none" : undefined}
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    >{enabled ? <button type="button"
      className="inline-flex min-h-10 items-center gap-1 rounded-sm text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={`Sort ${context.scope} by ${label}`} aria-label={`Sort ${context.scope} by ${label}`}
      onClick={(event) => {
        const table = event.currentTarget.closest("table")
        const snapshot: TableSortSnapshot = {}
        for (const row of table?.tBodies[0]?.rows ?? []) {
          const cell = row.cells[column]
          const id = row.getAttribute("data-sort-id")
          if (cell && id) snapshot[id] = { value: cell.getAttribute("data-sort-value") ?? cell.textContent ?? "", content: cell.getAttribute("data-sort-content") ?? "" }
        }
        if (column >= 0) context.setSort((prior) => ({ column, descending: prior?.column === column ? !prior.descending : false, snapshot }))
      }}>{children}<Icon aria-hidden="true" className="size-3 shrink-0 opacity-60" /></button> : children}</th>
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td"> & { "data-sort-value"?: string | number }) {
  return (
    <td
      data-slot="table-cell"
      data-sort-content={tableText(props.children)}
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
