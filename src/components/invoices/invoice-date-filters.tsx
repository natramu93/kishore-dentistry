"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InvoiceDateFilters({ mode, from, to }: { mode: string; from: string; to: string }) {
  const [selected, setSelected] = useState(mode);
  return <>
    <div className="space-y-1">
      <Label htmlFor="invoice-dates">Invoice dates</Label>
      <select id="invoice-dates" name="dates" value={selected} onChange={(event) => setSelected(event.target.value)}
        className="h-11 rounded-md border border-input bg-transparent px-3 text-sm">
        <option value="today">Today</option><option value="range">Date range</option><option value="all">All dates</option>
      </select>
    </div>
    {selected === "range" && <>
      <div className="space-y-1"><Label htmlFor="invoice-from">From date</Label><Input id="invoice-from" name="from" type="date" defaultValue={from} /></div>
      <div className="space-y-1"><Label htmlFor="invoice-to">To date</Label><Input id="invoice-to" name="to" type="date" defaultValue={to} /></div>
    </>}
  </>;
}
