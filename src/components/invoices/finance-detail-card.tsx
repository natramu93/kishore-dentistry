"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { financeDetailsAction } from "@/actions/finance-details";
import type { FinancialDetail, FinanceFilters, FinanceMetric } from "@/lib/finance-activity";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableHead, TableHeader, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { fmtDate, formatINR } from "@/lib/tz";
import { PAYMENT_LABELS } from "@/lib/reports/collections";

export function FinanceDetailCard({ label, amount, filters, source, metric = "receipts", accent = "border-l-emerald-400" }: {
  label: string; amount: number; filters: FinanceFilters; source: "invoices" | "reports"; metric?: FinanceMetric; accent?: string;
}) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<FinancialDetail>();
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pending, startTransition] = useTransition();
  const request = useRef(0);
  function load(next: number) {
    const token = ++request.current;
    setError("");
    startTransition(async () => {
      try {
        const result = await financeDetailsAction({ source, metric, filters, page: next });
        if (request.current !== token) return;
        if (result.ok) { setDetails(result.details); setPage(next); }
        else setError(result.error);
      } catch {
        if (request.current === token) setError("Could not load these line items. Please retry.");
      }
    });
  }
  return <Dialog open={open} onOpenChange={(value) => {
    setOpen(value);
    if (value) { setDetails(undefined); setPage(1); load(1); }
    else request.current++;
  }}>
    <DialogTrigger render={<button type="button"
      className={`w-full rounded-xl border border-l-4 bg-card p-4 text-left shadow-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${accent}`} />}>
      <span className="block text-sm text-muted-foreground">{label}</span>
      <span className="block break-words text-xl font-bold sm:text-2xl">{formatINR(amount)}</span>
      <span className="block text-xs text-muted-foreground">View line items</span>
    </DialogTrigger>
    <DialogContent className="sm:max-w-6xl">
      <DialogHeader>
        <DialogTitle>{label} — line items</DialogTitle>
        <DialogDescription>
          {metric === "receipts" ? "Payments by receipt date, independently of invoice date." : "Billed line items and adjustments by invoice date."}
          {" "}Voided and archived invoices are excluded.
        </DialogDescription>
      </DialogHeader>
      {pending && <p role="status">Loading line items…</p>}
      {error && <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => load(page)} disabled={pending}>Retry</Button></div>}
      {details && <>
        <p className="text-sm font-medium">{details.total} line items · Total {formatINR(details.amount)}</p>
        {Math.round(details.amount * 100) !== Math.round(amount * 100) && <p role="status" className="text-sm">The records have changed since this page loaded. The total above reflects the latest saved records.</p>}
        <Table aria-label={`${label} detail line items`} sortScope="this page of line items">
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Invoice</TableHead><TableHead>Invoice date</TableHead>
            <TableHead>Patient</TableHead><TableHead>Center</TableHead><TableHead>Description</TableHead>
            <TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead>
          </TableRow></TableHeader>
          <TableBody>{details.rows.map((row) => <TableRow key={row.id}>
            <TableCell data-sort-value={row.date}>{fmtDate(row.date)}</TableCell>
            <TableCell><Link href={`/invoices/${row.invoice_id}`} target="_blank" rel="noopener noreferrer" className="underline">{row.invoice_number}</Link></TableCell>
            <TableCell data-sort-value={row.invoice_date}>{fmtDate(row.invoice_date)}</TableCell>
            <TableCell><Link href={`/patients/${row.patient_id}`} target="_blank" rel="noopener noreferrer" className="underline">{row.patient_name}</Link></TableCell>
            <TableCell>{row.center}</TableCell><TableCell className="whitespace-normal">{row.description}</TableCell>
            <TableCell>{row.method ? PAYMENT_LABELS[row.method as keyof typeof PAYMENT_LABELS] ?? row.method : "—"}</TableCell>
            <TableCell>{row.reference ?? "—"}</TableCell>
            <TableCell data-sort-value={row.amount} className="text-right">{formatINR(row.amount)}</TableCell>
          </TableRow>)}
          {!details.rows.length && <TableRow><TableCell colSpan={9}>No line items match these filters.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">Page {page} of {Math.max(1, Math.ceil(details.total / 100))}</span>
          <div className="flex gap-2"><Button variant="outline" disabled={pending || page <= 1} onClick={() => load(page - 1)}>Previous</Button>
            <Button variant="outline" disabled={pending || page * 100 >= details.total} onClick={() => load(page + 1)}>Next</Button></div>
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
