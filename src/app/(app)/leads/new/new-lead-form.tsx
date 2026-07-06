"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createLeadAndRedirect, checkDuplicateMobile } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Branch, LeadSource } from "@/lib/database.types";
import Link from "next/link";

export function NewLeadForm({
  branches,
  sources,
}: {
  branches: Branch[];
  sources: LeadSource[];
}) {
  const [pending, startTransition] = useTransition();
  const [dupes, setDupes] = useState<{ id: string; name: string; status: string }[]>([]);

  async function onMobileBlur(e: React.FocusEvent<HTMLInputElement>) {
    const mobile = e.target.value.trim();
    if (mobile.length >= 7) {
      setDupes(await checkDuplicateMobile(mobile));
    } else {
      setDupes([]);
    }
  }

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createLeadAndRedirect(formData);
      if (result && !result.ok) toast.error(result.error);
    });
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mobile">Mobile *</Label>
              <Input id="mobile" name="mobile" required onBlur={onMobileBlur} />
            </div>
          </div>

          {dupes.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-800">
                Possible duplicate — this mobile already exists:
              </p>
              <ul className="mt-1 space-y-0.5">
                {dupes.map((d) => (
                  <li key={d.id}>
                    <Link href={`/leads/${d.id}`} className="underline text-amber-900">
                      {d.name}
                    </Link>{" "}
                    <span className="text-amber-700">({d.status.replaceAll("_", " ")})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="source_id">Lead source</Label>
              <select
                id="source_id"
                name="source_id"
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                defaultValue=""
              >
                <option value="">— Select —</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="branch_id">Branch / Center *</Label>
              <select
                id="branch_id"
                name="branch_id"
                required
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="age">Age</Label>
              <Input id="age" name="age" type="number" min="0" max="120" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dob">Date of birth</Label>
              <Input id="dob" name="dob" type="date" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={3} placeholder="What are they looking for?" />
          </div>

          <div className="flex justify-end gap-2">
            <Button asChild variant="ghost" type="button">
              <Link href="/leads">Cancel</Link>
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create lead"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
