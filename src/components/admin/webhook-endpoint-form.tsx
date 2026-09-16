"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionValueResult } from "@/actions/util";

type CreateResult = ActionValueResult<{ endpointPath: string; secret: string }>;

export function WebhookEndpointForm({
  branches,
  action,
}: {
  branches: Array<{ id: string; name: string }>;
  action: (formData: FormData) => Promise<CreateResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<{ endpointPath: string; secret: string } | null>(null);

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        setCreated({ endpointPath: result.endpointPath, secret: result.secret });
        toast.success("Webhook created. Copy the secret now; it is not shown again.");
      } else {
        toast.error(result.error);
      }
    });
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Copy failed. Select the ${label.toLowerCase()} and copy it manually.`);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h2 className="font-semibold">Create a provider webhook</h2>
        <p className="text-sm text-muted-foreground">Each call provider gets its own URL and secret.</p>
      </div>
      <form action={submit} className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="webhook-name">Name</Label>
          <Input id="webhook-name" name="name" required placeholder="AI receptionist" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="webhook-source">Source system</Label>
          <Input id="webhook-source" name="source_system" required placeholder="dental-receptionist" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="webhook-branch">Branch (optional)</Label>
          <select id="webhook-branch" name="branch_id" className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="">Match across branches only when unambiguous</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-3">
          <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create webhook"}</Button>
        </div>
      </form>
      {created && (
        <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
          <p className="font-medium">Save these credentials in the provider now.</p>
          <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
            <code className="break-all rounded bg-background p-2">{created.endpointPath}</code>
            <Button type="button" variant="outline" onClick={() => copy(created.endpointPath, "Endpoint URL")}>Copy URL path</Button>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
            <code className="break-all rounded bg-background p-2">{created.secret}</code>
            <Button type="button" variant="outline" onClick={() => copy(created.secret, "Secret")}>Copy secret</Button>
          </div>
          <p className="text-xs text-muted-foreground">Send the secret as <code>x-webhook-secret</code> or as a Bearer token. The URL accepts POST only.</p>
        </div>
      )}
    </div>
  );
}

