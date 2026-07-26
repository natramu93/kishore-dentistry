"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    if (!email) return;

    setPending(true);
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    // Deliberately use the same response for existing and unknown addresses.
    setSent(true);
    setPending(false);
  }

  return (
    <Card>
      <CardContent className="pt-6">
        {sent ? (
          <p role="status" className="text-sm">
            If an active account exists for that email, a recovery link has
            been sent. Check the inbox and spam folder.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recovery-email">Email</Label>
              <Input
                id="recovery-email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Sending…" : "Send recovery link"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
