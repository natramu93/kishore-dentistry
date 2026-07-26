import Link from "next/link";
import { getAuthContext } from "@/lib/auth/context";
import { listFollowUps } from "@/data/follow-ups";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaginationNav } from "@/components/pagination-nav";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { clinicDayRange, clinicToday, fmt } from "@/lib/tz";
import { CompleteFollowUpButtons } from "./complete-buttons";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import type { LeadStatus } from "@/lib/database.types";

export const metadata = { title: "Follow-ups — Kishore Dentistry CRM" };

const WINDOWS = ["overdue", "today", "upcoming"] as const;
type FollowUpWindow = (typeof WINDOWS)[number];

function isFollowUpWindow(value: string | undefined): value is FollowUpWindow {
  return WINDOWS.includes(value as FollowUpWindow);
}

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getAuthContext();
  const { end: todayEnd } = clinicDayRange(clinicToday());
  const now = new Date().toISOString();
  const selectedWindow: FollowUpWindow = isFollowUpWindow(params.window)
    ? params.window
    : "overdue";
  const filters = {
    overdue: { dueBefore: now },
    today: { dueFrom: now, dueBefore: todayEnd },
    upcoming: { dueFrom: todayEnd },
  } satisfies Record<
    FollowUpWindow,
    { dueFrom?: string; dueBefore?: string }
  >;

  const [selected, overdueResult, todayResult, upcomingResult] =
    await Promise.all([
      listFollowUps(ctx, {
        status: "pending",
        ...filters[selectedWindow],
        page: Number(params.page),
      }),
      listFollowUps(ctx, {
        status: "pending",
        ...filters.overdue,
        pageSize: 1,
      }),
      listFollowUps(ctx, {
        status: "pending",
        ...filters.today,
        pageSize: 1,
      }),
      listFollowUps(ctx, {
        status: "pending",
        ...filters.upcoming,
        pageSize: 1,
      }),
    ]);
  const counts: Record<FollowUpWindow, number> = {
    overdue: overdueResult.total,
    today: todayResult.total,
    upcoming: upcomingResult.total,
  };
  const labels: Record<FollowUpWindow, string> = {
    overdue: "Overdue",
    today: "Due today",
    upcoming: "Upcoming",
  };
  const badgeVariants: Record<
    FollowUpWindow,
    "destructive" | "default" | "secondary"
  > = {
    overdue: "destructive",
    today: "default",
    upcoming: "secondary",
  };
  const pendingTotal = counts.overdue + counts.today + counts.upcoming;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Follow-ups</h1>
        <p className="text-sm text-muted-foreground">
          {counts.overdue} overdue · {counts.today} due today ·{" "}
          {counts.upcoming} upcoming
        </p>
      </div>

      <nav
        aria-label="Follow-up due window"
        className="flex flex-wrap gap-2"
      >
        {WINDOWS.map((window) => (
          <Button
            key={window}
            asChild
            size="sm"
            variant={selectedWindow === window ? "default" : "outline"}
          >
            <Link
              href={
                window === "overdue"
                  ? "/follow-ups"
                  : `/follow-ups?window=${window}`
              }
              aria-current={selectedWindow === window ? "page" : undefined}
            >
              {labels[window]} ({counts[window]})
            </Link>
          </Button>
        ))}
      </nav>

      {selected.followUps.length > 0 ? (
        <section className="space-y-2" aria-labelledby="follow-up-window-title">
          <h2
            id="follow-up-window-title"
            className="flex items-center gap-2 font-semibold"
          >
            {labels[selectedWindow]}
            <Badge variant={badgeVariants[selectedWindow]}>
              {selected.total}
            </Badge>
          </h2>
          <Table aria-label={`${labels[selectedWindow]} follow-ups`}>
            <TableHeader>
              <TableRow>
                <TableHead>Due</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead className="hidden md:table-cell">Center</TableHead>
                <TableHead className="hidden lg:table-cell">Reason</TableHead>
                <TableHead className="hidden lg:table-cell">Lead status</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selected.followUps.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="whitespace-nowrap font-medium">
                    <span className="sm:hidden">
                      {fmt(f.due_at, "d MMM")}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {fmt(f.due_at, "h:mm a")}
                      </span>
                    </span>
                    <span className="hidden sm:inline">{fmt(f.due_at)}</span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {f.lead ? (
                      <Link href={`/leads/${f.lead.id}`} className="font-medium hover:underline">
                        {f.lead.name}
                      </Link>
                    ) : "—"}
                    {f.lead?.mobile && (
                      <a
                        href={`tel:${f.lead.mobile}`}
                        className="block text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {f.lead.mobile}
                      </a>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground lg:hidden">
                      {f.reason ?? "No reason recorded"}
                    </div>
                    <div className="mt-1 lg:hidden">
                      {f.lead && <LeadStatusBadge status={f.lead.status as LeadStatus} />}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{f.branch?.name ?? "—"}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{f.reason ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {f.lead && <LeadStatusBadge status={f.lead.status as LeadStatus} />}
                  </TableCell>
                  <TableCell className="text-right">
                    <CompleteFollowUpButtons followUpId={f.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground border rounded-lg p-8 text-center">
          No {labels[selectedWindow].toLowerCase()} follow-ups.
        </p>
      )}
      <PaginationNav
        pathname="/follow-ups"
        searchParams={params}
        page={selected.page}
        pageSize={selected.pageSize}
        total={selected.total}
      />
      {pendingTotal === 0 && (
        <p className="text-sm text-muted-foreground">
          Leads in the <strong>Follow Up</strong> stage appear here.
        </p>
      )}
    </div>
  );
}
