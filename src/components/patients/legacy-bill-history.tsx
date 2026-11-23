import { fmt, formatINR } from "@/lib/tz";
import type { listLegacyPatientBills } from "@/data/legacy-patient-bills";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaginationNav } from "@/components/pagination-nav";

type History = Awaited<ReturnType<typeof listLegacyPatientBills>>;

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
        : "Read-only copies of old bills. These records do not affect current balances, payments or revenue."}</p>
    </CardHeader>
    <CardContent className="space-y-3">
      {history.records.map((bill) => <details key={bill.bill_number} className="rounded-md border px-3 py-2">
        <summary className="cursor-pointer break-words text-sm font-medium">
          {fmt(bill.billed_at)}{!clinicalOnly && ` · Bill ${bill.bill_number}`}
          {!clinicalOnly && "net_paise" in bill && ` · ${formatINR(bill.net_paise / 100)}`}
        </summary>
        {!clinicalOnly && "service_lines" in bill && Array.isArray(bill.service_lines)
          ? <>
              <p className="mt-2 text-xs text-muted-foreground">Gross {formatINR(bill.gross_paise / 100)} · Discount {formatINR(bill.discount_paise / 100)} · Tax {formatINR(bill.tax_paise / 100)}</p>
              <ul className="mt-1 divide-y text-sm">
                {bill.service_lines.map((line, index) => {
                  if (!line || typeof line !== "object" || Array.isArray(line) || typeof line.service !== "string" || typeof line.net_paise !== "number") return null;
                  return <li key={index} className="space-y-1 py-2">
                    <div className="flex justify-between gap-3"><span className="min-w-0 break-words">{line.service}</span><span className="shrink-0">{formatINR(line.net_paise / 100)}</span></div>
                    {typeof line.treating_consultant === "string" && line.treating_consultant && <p className="text-xs text-muted-foreground">{line.treating_consultant}</p>}
                  </li>;
                })}
              </ul>
            </>
          : <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{bill.service_names.map((name) => <li key={name} className="break-words">{name}</li>)}</ul>}
      </details>)}
      <PaginationNav pathname={pathname} searchParams={query} page={history.page} pageSize={history.pageSize} total={history.total} pageParam="legacyPage" anchor="legacy-bill-history" />
    </CardContent>
  </Card>;
}
