import { fmt, formatINR } from "@/lib/tz";
import type { listLegacyPatientBills } from "@/data/legacy-patient-bills";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PaginationNav } from "@/components/pagination-nav";

type History = Awaited<ReturnType<typeof listLegacyPatientBills>>;
const sourceMethodLabels: ReadonlyMap<string, string> = new Map([
  ["cash", "Cash"], ["upi", "UPI"], ["card", "Card"], ["neft", "NEFT"], ["cheque", "Cheque"], ["dd", "Demand draft"],
]);

export function LegacyBillHistory({ history, pathname, query, clinicalOnly = false }: {
  history: History;
  pathname: string;
  query: Record<string, string | undefined>;
  clinicalOnly?: boolean;
}) {
  if (!history.total) return null;
  return <Card id="legacy-bill-history" className="min-w-0 scroll-mt-20">
    <CardHeader>
      <CardTitle className="text-base">{clinicalOnly ? "Previous services (old billing records)" : "Historical bills (old system)"}</CardTitle>
      <p className="text-sm text-muted-foreground">{clinicalOnly
        ? "Services listed in the old billing export. These entries are not signed case sheets."
        : "These are copies of the original bills. Payment amounts and receipt dates were not verified. These records do not affect current balances, payments or revenue."}</p>
    </CardHeader>
    <CardContent className="space-y-3">
      {history.records.map((bill) => {
        const lines = !clinicalOnly && "service_lines" in bill && Array.isArray(bill.service_lines) ? bill.service_lines : null;
        const methods = [...new Set(lines?.flatMap((line) => {
          if (!line || typeof line !== "object" || Array.isArray(line) || typeof line.source_payment_type !== "string") return [];
          const method = sourceMethodLabels.get(line.source_payment_type.trim().toLowerCase());
          return method ? [method] : [];
        }))];
        return <details key={`${bill.branch_id}:${bill.bill_number}`} className="rounded-md border px-3 py-2">
          <summary className="cursor-pointer break-words text-sm font-medium">
            {fmt(bill.billed_at)}{!clinicalOnly && ` · Bill ${bill.bill_number}`}
            {bill.billing_branch?.name && ` · ${bill.billing_branch.name}`}
            {!clinicalOnly && "net_paise" in bill && <>
              {` · Billed ${formatINR(bill.net_paise / 100)}`}
              <Badge variant="outline" className="ml-2">Payment unverified</Badge>
            </>}
          </summary>
          {lines && "gross_paise" in bill ? <>
              <p className="mt-2 text-xs text-muted-foreground">Gross {formatINR(bill.gross_paise / 100)} · Discount {formatINR(bill.discount_paise / 100)} · Tax {formatINR(bill.tax_paise / 100)}</p>
              {methods.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Payment method listed in the original export: {methods.join(", ")}. This is not a receipt.</p>}
              <ul className="mt-1 divide-y text-sm">
                {lines.map((line, index) => {
                  if (!line || typeof line !== "object" || Array.isArray(line) || typeof line.service !== "string" || typeof line.net_paise !== "number") return null;
                  return <li key={index} className="space-y-1 py-2">
                    <div className="flex justify-between gap-3"><span className="min-w-0 break-words">{line.service}</span><span className="shrink-0">{formatINR(line.net_paise / 100)}</span></div>
                    {typeof line.treating_consultant === "string" && line.treating_consultant && <p className="text-xs text-muted-foreground">{line.treating_consultant}</p>}
                  </li>;
                })}
              </ul>
            </> : <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{bill.service_names.map((name) => <li key={name} className="break-words">{name}</li>)}</ul>}
        </details>;
      })}
      <PaginationNav pathname={pathname} searchParams={query} page={history.page} pageSize={history.pageSize} total={history.total} pageParam="legacyPage" anchor="legacy-bill-history" />
    </CardContent>
  </Card>;
}
