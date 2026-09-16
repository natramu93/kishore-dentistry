import { getAuthContext } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import { listBranches } from "@/data/branches";
import { listWebhookEndpoints, listWebhookEvents } from "@/data/call-tracking";
import { createWebhookEndpointAction, revokeWebhookEndpointAction } from "@/actions/admin";
import { WebhookEndpointForm } from "@/components/admin/webhook-endpoint-form";
import { ToggleActiveButton } from "@/components/admin/toggle-active-button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Webhooks — Admin" };

export default async function WebhooksPage() {
  const ctx = await getAuthContext();
  if (ctx.role !== "admin") redirect("/dashboard");
  const [endpoints, branches, events] = await Promise.all([
    listWebhookEndpoints(ctx),
    listBranches(ctx, { includeInactive: true }),
    listWebhookEvents(ctx),
  ]);
  const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">External webhooks</h1>
        <p className="text-sm text-muted-foreground">
          Receive call and appointment updates from AI or cloud providers. Secrets are stored as hashes and shown only once.
        </p>
      </div>
      <WebhookEndpointForm branches={branches} action={createWebhookEndpointAction} />
      <Table aria-label="External webhook endpoints">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last received</TableHead>
            <TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {endpoints.map((endpoint) => (
            <TableRow key={endpoint.id}>
              <TableCell className="font-medium">
                {endpoint.name}
                <div className="text-xs text-muted-foreground">URL key …{endpoint.endpoint_key_prefix}</div>
              </TableCell>
              <TableCell>{endpoint.source_system}</TableCell>
              <TableCell>{endpoint.branch_id ? branchNames.get(endpoint.branch_id) ?? "Unknown branch" : "All branches"}</TableCell>
              <TableCell><Badge variant={endpoint.is_active ? "default" : "secondary"}>{endpoint.is_active ? "Active" : "Revoked"}</Badge></TableCell>
              <TableCell>{endpoint.last_received_at ? new Date(endpoint.last_received_at).toLocaleString("en-IN") : "Never"}</TableCell>
              <TableCell className="text-right">
                {endpoint.is_active && <ToggleActiveButton isActive action={revokeWebhookEndpointAction.bind(null, endpoint.id)} />}
              </TableCell>
            </TableRow>
          ))}
          {endpoints.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No provider webhooks yet.</TableCell></TableRow>}
        </TableBody>
      </Table>
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Recent provider events</h2>
          <p className="text-sm text-muted-foreground">Inspect unfamiliar payloads here before adding stricter provider-specific rules.</p>
        </div>
        <Table aria-label="Recent webhook events">
          <TableHeader><TableRow><TableHead>Received</TableHead><TableHead>Event</TableHead><TableHead>External IDs</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {events.map((event) => <TableRow key={event.id}><TableCell>{new Date(event.received_at).toLocaleString("en-IN")}</TableCell><TableCell>{event.event_type ?? "Unspecified"}</TableCell><TableCell className="text-xs">{event.external_call_id ?? event.external_appointment_id ?? "Not normalized"}</TableCell><TableCell><Badge variant={event.processing_status === "failed" ? "destructive" : event.processing_status === "processed" ? "default" : "secondary"}>{event.processing_status}</Badge></TableCell><TableCell className="text-right"><a className="text-sm text-primary underline" href={`/admin/webhooks/events/${event.id}`}>Inspect</a></TableCell></TableRow>)}
            {events.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No provider events received yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
