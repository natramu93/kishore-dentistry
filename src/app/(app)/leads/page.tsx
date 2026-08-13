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
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/lib/tz";
import { Plus } from "lucide-react";
import { PaginationNav } from "@/components/pagination-nav";

export const metadata = { title: "Leads — Dr. Kishor's Dentistry CRM" };

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
  const [{ leads, total, page, pageSize }, branches, sources] = await Promise.all([
    listLeads(ctx, {
      status,
      branchId: params.branch || undefined,
      sourceId: params.source || undefined,
      search: params.q || undefined,
      page: Number(params.page),
    }),
    listMyBranches(ctx),
    listLeadSources(ctx),
  ]);

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
      <form className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end" action="/leads" method="get">
        <div className="col-span-2 space-y-1 sm:w-64">
          <Label htmlFor="lead-search" className="text-xs text-muted-foreground">Search</Label>
          <Input
            id="lead-search"
            name="q"
            type="search"
            placeholder="Name, mobile, or email"
            defaultValue={params.q}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lead-status-filter" className="text-xs text-muted-foreground">Status</Label>
          <select
            id="lead-status-filter"
            name="status"
            defaultValue={params.status ?? ""}
            className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        {branches.length > 1 && (
          <div className="space-y-1">
            <Label htmlFor="lead-branch-filter" className="text-xs text-muted-foreground">Center</Label>
            <select
              id="lead-branch-filter"
              name="branch"
              defaultValue={params.branch ?? ""}
              className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">All centers</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="lead-source-filter" className="text-xs text-muted-foreground">Source</Label>
          <select
            id="lead-source-filter"
            name="source"
            defaultValue={params.source ?? ""}
            className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2 flex gap-2 sm:col-span-1">
          <Button type="submit" variant="secondary" size="sm" className="flex-1 sm:flex-none">Filter</Button>
          <Button asChild variant="ghost" size="sm" className="flex-1 sm:flex-none">
            <Link href="/leads">Reset</Link>
          </Button>
        </div>
      </form>

      <Table aria-label="Leads">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden sm:table-cell">Mobile</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden lg:table-cell">Interest</TableHead>
            <TableHead className="hidden md:table-cell">Center</TableHead>
            <TableHead className="hidden lg:table-cell">Source</TableHead>
            <TableHead className="hidden xl:table-cell">Assignee</TableHead>
            <TableHead className="hidden xl:table-cell">Created</TableHead>
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
              <TableCell className="whitespace-normal">
                <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                  {l.name}
                </Link>
                <a
                  href={`tel:${l.mobile}`}
                  className="mt-1 block text-xs text-muted-foreground underline-offset-2 hover:underline sm:hidden"
                >
                  {l.mobile}
                </a>
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                <a href={`tel:${l.mobile}`} className="underline-offset-2 hover:underline">{l.mobile}</a>
              </TableCell>
              <TableCell><LeadStatusBadge status={l.status} /></TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell">{l.interest?.name ?? "—"}</TableCell>
              <TableCell className="hidden md:table-cell">{l.branch?.name ?? "—"}</TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell">{l.source?.name ?? "—"}</TableCell>
              <TableCell className="hidden text-muted-foreground xl:table-cell">
                {l.assignee?.full_name ?? <span className="italic">Unassigned</span>}
              </TableCell>
              <TableCell className="hidden text-muted-foreground xl:table-cell">{fmtDate(l.created_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <PaginationNav
        pathname="/leads"
        searchParams={params}
        page={page}
        pageSize={pageSize}
        total={total}
      />
    </div>
  );
}
