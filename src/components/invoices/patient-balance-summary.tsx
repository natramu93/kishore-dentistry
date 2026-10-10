import Link from "next/link";
import type { PatientInvoiceBalance } from "@/lib/patient-invoice-balance";
import { formatINR } from "@/lib/tz";

export function PatientBalanceSummary({ balance, leadId }: { balance: PatientInvoiceBalance; leadId: string }) {
  return <section aria-label="Patient outstanding balance" className="mt-4 space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
    <h2 className="font-semibold">Patient outstanding balance</h2>
    <div className="flex justify-between gap-4"><span>Earlier unpaid bills ({balance.earlier_invoice_count})</span><span>{formatINR(balance.earlier_due)}</span></div>
    <div className="flex justify-between gap-4"><span>This invoice due</span><span>{formatINR(balance.invoice_due)}</span></div>
    {balance.later_due > 0 && <div className="flex justify-between gap-4"><span>Newer unpaid bills</span><span>{formatINR(balance.later_due)}</span></div>}
    <div className="flex justify-between gap-4 border-t pt-2 text-base font-bold"><span>Overall patient due</span><span>{formatINR(balance.overall_due)}</span></div>
    <p className="text-xs text-muted-foreground">Current balances across all active bills. Earlier dues are carried forward for visibility, not billed again. Payments remain recorded against their original invoice.</p>
    <Link href={`/leads/${leadId}#patient-invoices`} className="inline-block font-medium underline underline-offset-4">View all patient bills / record earlier payments</Link>
  </section>;
}
