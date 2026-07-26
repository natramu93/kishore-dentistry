"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { createLeadAndRedirect, checkDuplicateMobile } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Branch, LeadSource } from "@/lib/database.types";
import Link from "next/link";

type InterestGroup = { category: string; items: { id: string; name: string }[] };

export function NewLeadForm({
  branches,
  sources,
  interestGroups,
}: {
  branches: Branch[];
  sources: LeadSource[];
  interestGroups: InterestGroup[];
}) {
  const [pending, startTransition] = useTransition();
  const [dupes, setDupes] = useState<{ id: string; name: string; status: string }[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [dirty, setDirty] = useState(false);
  const duplicateRequest = useRef(0);

  useEffect(() => {
    if (!dirty || pending) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty, pending]);

  async function onMobileBlur(e: React.FocusEvent<HTMLInputElement>) {
    const mobile = e.target.value.trim();
    const requestId = duplicateRequest.current + 1;
    duplicateRequest.current = requestId;

    if (mobile.length < 7) {
      setDupes([]);
      setCheckingDuplicates(false);
      return;
    }

    setCheckingDuplicates(true);
    try {
      const matches = await checkDuplicateMobile(mobile);
      if (duplicateRequest.current === requestId) setDupes(matches);
    } finally {
      if (duplicateRequest.current === requestId) setCheckingDuplicates(false);
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
        <form
          action={submit}
          className="space-y-4"
          onChange={() => setDirty(true)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" name="name" autoComplete="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mobile">Mobile *</Label>
              <Input
                id="mobile"
                name="mobile"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                aria-describedby="mobile-duplicate-status"
                required
                onChange={() => {
                  duplicateRequest.current += 1;
                  setCheckingDuplicates(false);
                  setDupes([]);
                }}
                onBlur={onMobileBlur}
              />
            </div>
          </div>

          <div id="mobile-duplicate-status" role="status" aria-live="polite" aria-atomic="true">
            {checkingDuplicates && (
              <p className="text-sm text-muted-foreground">Checking for duplicate mobile numbers…</p>
            )}
            {!checkingDuplicates && dupes.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-900">
                  Possible duplicate — this mobile already exists:
                </p>
                <ul className="mt-1 space-y-1">
                  {dupes.map((duplicate) => (
                    <li key={duplicate.id}>
                      <Link href={`/leads/${duplicate.id}`} className="text-amber-950 underline">
                        {duplicate.name}
                      </Link>{" "}
                      <span className="text-amber-900">
                        ({duplicate.status.replaceAll("_", " ")})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="source_id">Lead source</Label>
              <select
                id="source_id"
                name="source_id"
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                defaultValue=""
              >
                <option value="">— Select —</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interest_id">Treatment interest</Label>
            <select
              id="interest_id"
              name="interest_id"
              className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              defaultValue=""
            >
              <option value="">— What are they enquiring about? —</option>
              {interestGroups.map((g) => (
                <optgroup key={g.category} label={g.category}>
                  {g.items.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="branch_id">Branch / Center *</Label>
              <select
                id="branch_id"
                name="branch_id"
                required
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
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

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button asChild variant="ghost" type="button">
              <Link
                href="/leads"
                onClick={(event) => {
                  if (
                    dirty &&
                    !window.confirm("Discard this unsaved lead?")
                  ) {
                    event.preventDefault();
                  }
                }}
              >
                Cancel
              </Link>
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
