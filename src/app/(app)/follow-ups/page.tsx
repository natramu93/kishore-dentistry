import Link from "next/link";
import { getAuthContext } from "@/lib/auth/context";
import { listFollowUps } from "@/data/follow-ups";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { clinicDayRange, clinicToday, fmt } from "@/lib/tz";
import { CompleteFollowUpButtons } from "./complete-buttons";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import type { LeadStatus } from "@/lib/database.types";

export const metadata = { title: "Follow-ups — Kishore Dentistry CRM" };

export default async function FollowUpsPage() {
  const ctx = await getAuthContext();
  const pending = await listFollowUps(ctx, { status: "pending" });
  const { end: todayEnd } = clinicDayRange(clinicToday());

  const overdue = pending.filter((f) => f.due_at < new Date().toISOString());
  const dueToday = pending.filter(
    (f) => f.due_at >= new Date().toISOString() && f.due_at < todayEnd
  );
  const upcoming = pending.filter((f) => f.due_at >= todayEnd);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Follow-ups</h1>
        <p className="text-sm text-muted-foreground">
          {overdue.length} overdue · {dueToday.length} due today · {upcoming.length} upcoming
        </p>
      </div>

      {[
        { title: "Overdue", rows: overdue, badge: "destructive" as const },
        { title: "Due today", rows: dueToday, badge: "default" as const },
        { title: "Upcoming", rows: upcoming, badge: "secondary" as const },
      ].map(
        (section) =>
          section.rows.length > 0 && (
            <div key={section.title} className="space-y-2">
              <h2 className="font-semibold flex items-center gap-2">
                {section.title}
                <Badge variant={section.badge}>{section.rows.length}</Badge>
              </h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Due</TableHead>
                    <TableHead>Lead</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Lead status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.rows.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="whitespace-nowrap font-medium">{fmt(f.due_at)}</TableCell>
                      <TableCell>
                        {f.lead ? (
                          <Link href={`/leads/${f.lead.id}`} className="font-medium hover:underline">
                            {f.lead.name}
                          </Link>
                        ) : "—"}
                        <div className="text-xs text-muted-foreground">{f.lead?.mobile}</div>
                      </TableCell>
                      <TableCell>{f.branch?.name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{f.reason ?? "—"}</TableCell>
                      <TableCell>
                        {f.lead && <LeadStatusBadge status={f.lead.status as LeadStatus} />}
                      </TableCell>
                      <TableCell className="text-right">
                        <CompleteFollowUpButtons followUpId={f.id} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
      )}

      {pending.length === 0 && (
        <p className="text-sm text-muted-foreground border rounded-lg p-8 text-center">
          No pending follow-ups. Leads in the <strong>Follow Up</strong> stage appear here.
        </p>
      )}
    </div>
  );
}
