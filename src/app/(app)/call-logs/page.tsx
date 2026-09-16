import Link from "next/link";
import { getAuthContext } from "@/lib/auth/context";
import { listCallLogs, listExternalAppointments } from "@/data/call-tracking";
import type { CallLog } from "@/lib/database.types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Call logs" };

const STATUS_LABELS: Record<CallLog["status"], string> = {
  ringing: "Ringing",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  missed: "Missed",
  no_answer: "No answer",
  unknown: "Unknown",
};

function value(searchParams: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const item = searchParams[key];
  return Array.isArray(item) ? item[0] : item;
}

function dateLabel(value: string | null): string {
  return value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default async function CallLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getAuthContext();
  const params = await searchParams;
  const search = value(params, "search") ?? "";
  const status = value(params, "status") as CallLog["status"] | undefined;
  const [{ callLogs, total }, externalAppointments] = await Promise.all([
    listCallLogs(ctx, { search, status, pageSize: 50 }),
    listExternalAppointments(ctx),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Call logs</h1>
        <p className="text-sm text-muted-foreground">AI and cloud call updates are matched to leads by branch and mobile number when the match is unambiguous.</p>
      </div>
      <Card>
        <CardContent className="pt-5">
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" method="get">
            <div className="flex-1 space-y-2">
              <label htmlFor="call-search" className="text-sm font-medium">Search calls</label>
              <Input id="call-search" name="search" defaultValue={search} placeholder="Mobile, caller, or provider call ID" />
            </div>
            <div className="space-y-2 sm:w-48">
              <label htmlFor="call-status" className="text-sm font-medium">Status</label>
              <select id="call-status" name="status" defaultValue={status ?? ""} className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">All statuses</option>
                {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>
            <Button type="submit">Filter</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{total} call{total === 1 ? "" : "s"}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table aria-label="Call logs">
            <TableHeader><TableRow><TableHead>Caller</TableHead><TableHead>Status</TableHead><TableHead>Lead</TableHead><TableHead className="hidden md:table-cell">Source</TableHead><TableHead>Started</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {callLogs.map((call) => (
                <TableRow key={call.id}>
                  <TableCell className="font-medium">
                    {call.caller_name ?? "Unknown caller"}
                    <div className="text-xs text-muted-foreground">{call.phone ?? call.external_call_id}</div>
                  </TableCell>
                  <TableCell><Badge variant={call.status === "completed" ? "default" : call.status === "failed" || call.status === "missed" ? "destructive" : "secondary"}>{STATUS_LABELS[call.status]}</Badge></TableCell>
                  <TableCell>{call.lead ? <Link className="hover:underline" href={`/leads/${call.lead.id}`}>{call.lead.name}</Link> : <span className="text-muted-foreground">Unmatched</span>}</TableCell>
                  <TableCell className="hidden md:table-cell">{call.source_system}</TableCell>
                  <TableCell>{dateLabel(call.started_at)}</TableCell>
                  <TableCell className="text-right"><Button render={<Link href={`/call-logs/${call.id}`} />} variant="outline" size="sm">View</Button></TableCell>
                </TableRow>
              ))}
              {callLogs.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No call events match these filters.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>External appointment updates</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table aria-label="External appointment updates">
            <TableHeader><TableRow><TableHead>Patient</TableHead><TableHead>Status</TableHead><TableHead>Scheduled</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
            <TableBody>
              {externalAppointments.slice(0, 20).map((appointment) => <TableRow key={appointment.id}><TableCell>{appointment.lead ? <Link className="hover:underline" href={`/leads/${appointment.lead.id}`}>{appointment.lead.name}</Link> : appointment.patient_name ?? "Unknown patient"}<div className="text-xs text-muted-foreground">{appointment.mobile ?? "No mobile"}</div></TableCell><TableCell><Badge variant={appointment.status === "cancelled" ? "destructive" : "secondary"}>{appointment.status.replace("_", " ")}</Badge></TableCell><TableCell>{dateLabel(appointment.scheduled_at)}</TableCell><TableCell>{appointment.source_system}</TableCell></TableRow>)}
              {externalAppointments.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No external appointment updates yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

