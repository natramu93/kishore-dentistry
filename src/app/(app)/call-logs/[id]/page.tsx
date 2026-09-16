import { notFound } from "next/navigation";
import Link from "next/link";
import { getAuthContext } from "@/lib/auth/context";
import { getCallLog } from "@/data/call-tracking";
import { externalHttpUrl } from "@/lib/webhooks/call-tracking-normalizer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function dateLabel(value: string | null): string {
  return value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default async function CallLogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  const { id } = await params;
  const call = await getCallLog(ctx, id);
  if (!call) notFound();
  const recordingUrl = externalHttpUrl(call.recording_url);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><Button variant="ghost" render={<Link href="/call-logs" />}>← Call logs</Button><h1 className="mt-2 text-2xl font-bold tracking-tight">{call.caller_name ?? "Call details"}</h1><p className="text-sm text-muted-foreground">{call.phone ?? "No phone number"} · {call.source_system}</p></div>
        <Badge>{call.status.replace("_", " ")}</Badge>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Call summary</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><dl className="grid grid-cols-2 gap-3"><div><dt className="text-muted-foreground">Lead</dt><dd>{call.lead ? <Link className="hover:underline" href={`/leads/${call.lead.id}`}>{call.lead.name}</Link> : "Unmatched"}</dd></div><div><dt className="text-muted-foreground">Direction</dt><dd>{call.direction}</dd></div><div><dt className="text-muted-foreground">Started</dt><dd>{dateLabel(call.started_at)}</dd></div><div><dt className="text-muted-foreground">Ended</dt><dd>{dateLabel(call.ended_at)}</dd></div><div><dt className="text-muted-foreground">Duration</dt><dd>{call.duration_seconds === null ? "—" : `${call.duration_seconds}s`}</dd></div><div><dt className="text-muted-foreground">Disposition</dt><dd>{call.disposition ?? "—"}</dd></div></dl><div><h2 className="font-medium">Summary</h2><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{call.summary ?? "No summary provided."}</p></div>{recordingUrl ? <p><a className="text-primary underline" href={recordingUrl} target="_blank" rel="noreferrer">Open recording</a></p> : call.recording_url && <p className="break-all text-muted-foreground">Recording: {call.recording_url}</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Status history</CardTitle></CardHeader><CardContent><ol className="space-y-3">{call.statusEvents.map((event) => <li key={event.id} className="flex items-start justify-between gap-3 border-b pb-3 last:border-0"><div><p className="font-medium">{event.status.replace("_", " ")}</p><p className="text-xs text-muted-foreground">{dateLabel(event.occurred_at ?? event.created_at)}</p></div></li>)}{call.statusEvents.length === 0 && <li className="text-sm text-muted-foreground">No status history.</li>}</ol></CardContent></Card>
      </div>
      {call.lastWebhookEvent && <Card><CardHeader><CardTitle>Provider event</CardTitle></CardHeader><CardContent><p className="mb-2 text-sm text-muted-foreground">Received {dateLabel(call.lastWebhookEvent.received_at)} · {call.lastWebhookEvent.event_type ?? "unspecified event"} · {call.lastWebhookEvent.processing_status}</p><pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(call.lastWebhookEvent.body ?? call.lastWebhookEvent.body_text, null, 2)}</pre></CardContent></Card>}
    </div>
  );
}

