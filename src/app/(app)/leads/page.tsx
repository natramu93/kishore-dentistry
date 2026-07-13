import Link from "next/link";
import { getAuthContext } from "@/lib/auth/context";
import { listLeads } from "@/data/leads";
import { listMyBranches } from "@/data/branches";
import { listLeadSources } from "@/data/catalogs";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import { STATUS_LABELS } from "@/lib/leads/transitions";
import type { LeadStatus } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/lib/tz";
import { Plus } from "lucide-react";

export const metadata = { title: "Leads — Kishore Dentistry CRM" };

const STATUSES = Object.keys(STATUS_LABELS) as LeadStatus[];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getAuthContext();

  const status = STATUSES.includes(params.status as LeadStatus)
    ? (params.status as LeadStatus)
    : undefined;
  const page = Math.max(1, Number(params.page) || 1);

  const [{ leads, total, pageSize }, branches, sources] = await Promise.all([
    listLeads(ctx, {
      status,
      branchId: params.branch || undefined,
      sourceId: params.source || undefined,
      search: params.q || undefined,
      page,
    }),
    listMyBranches(ctx),
    listLeadSources(ctx),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (overrides: Record<string, string | number | undefined>) => {
    const merged = { ...params, ...overrides };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== "") sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">{total} lead{total === 1 ? "" : "s"}</p>
        </div>
        <Button asChild className="shrink-0">
          <Link href="/leads/new">
            <Plus className="h-4 w-4 mr-1" />
            New lead
          </Link>
        </Button>
      </div>

      {/* Filters (GET form — server-rendered, no client state) */}
      <form className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:items-end" action="/leads" method="get">
        <Input
          name="q"
          placeholder="Search name / mobile / email"
          defaultValue={params.q}
          className="col-span-2 sm:w-56"
        />
        <select
          name="status"
          defaultValue={params.status ?? ""}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        {branches.length > 1 && (
          <select
            name="branch"
            defaultValue={params.branch ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
        <select
          name="source"
          defaultValue={params.source ?? ""}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <Button type="submit" variant="secondary" size="sm" className="flex-1 sm:flex-none">Filter</Button>
        <Button asChild variant="ghost" size="sm" className="flex-1 sm:flex-none">
          <Link href="/leads">Reset</Link>
        </Button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Mobile</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Interest</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Assignee</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                No leads match these filters
              </TableCell>
            </TableRow>
          )}
          {leads.map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                  {l.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{l.mobile}</TableCell>
              <TableCell><LeadStatusBadge status={l.status} /></TableCell>
              <TableCell className="text-muted-foreground">{l.interest?.name ?? "—"}</TableCell>
              <TableCell>{l.branch?.name ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">{l.source?.name ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">
                {l.assignee?.full_name ?? <span className="italic">Unassigned</span>}
              </TableCell>
              <TableCell className="text-muted-foreground">{fmtDate(l.created_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm" disabled={page <= 1}>
              <Link href={`/leads${qs({ page: page - 1 })}`}>Previous</Link>
            </Button>
            <Button asChild variant="outline" size="sm" disabled={page >= totalPages}>
              <Link href={`/leads${qs({ page: page + 1 })}`}>Next</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
