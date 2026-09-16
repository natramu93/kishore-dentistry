import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getWebhookEvent } from "@/data/call-tracking";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function WebhookEventPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  const { id } = await params;
  const event = await getWebhookEvent(ctx, id);
  if (!event) notFound();
  return (
    <div className="space-y-5">
      <Button variant="ghost" render={<Link href="/admin/webhooks" />}>← Webhooks</Button>
      <div><h1 className="text-2xl font-bold tracking-tight">Provider event</h1><p className="text-sm text-muted-foreground">Received {new Date(event.received_at).toLocaleString("en-IN")}</p></div>
      <Card><CardHeader><CardTitle className="flex flex-wrap items-center gap-2">{event.event_type ?? "Unspecified event"}<Badge variant={event.processing_status === "failed" ? "destructive" : "secondary"}>{event.processing_status}</Badge></CardTitle></CardHeader><CardContent className="space-y-4"><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Event ID</dt><dd className="break-all">{event.external_event_id ?? "—"}</dd></div><div><dt className="text-muted-foreground">Call ID</dt><dd className="break-all">{event.external_call_id ?? "—"}</dd></div><div><dt className="text-muted-foreground">Appointment ID</dt><dd className="break-all">{event.external_appointment_id ?? "—"}</dd></div><div><dt className="text-muted-foreground">Processing error</dt><dd>{event.processing_error ?? "—"}</dd></div></dl><div><h2 className="mb-2 font-medium">Headers</h2><pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(event.headers, null, 2)}</pre></div><div><h2 className="mb-2 font-medium">Body</h2><pre className="max-h-[32rem] overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(event.body ?? event.body_text, null, 2)}</pre></div></CardContent></Card>
    </div>
  );
}

