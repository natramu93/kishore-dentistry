"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordUpdateForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("password_confirmation") ?? "");
    setMessage(null);
    if (password.length < 12) {
      setMessage({ type: "error", text: "Password must be at least 12 characters." });
      return;
    }
    if (password !== confirmation) {
      setMessage({ type: "error", text: "Passwords do not match." });
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMessage({ type: "error", text: "We couldn't update your password. Please try again." });
        return;
      }
      formRef.current?.reset();
      setMessage({ type: "success", text: "Your password has been updated." });
    } catch {
      setMessage({ type: "error", text: "We couldn't update your password. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="max-w-xl space-y-4">
      {message && (
        <p role={message.type === "error" ? "alert" : "status"} className={message.type === "error" ? "text-sm text-destructive" : "text-sm text-emerald-700 dark:text-emerald-400"}>
          {message.text}
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="profile-new-password">New password</Label>
        <Input id="profile-new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="profile-confirm-password">Confirm password</Label>
        <Input id="profile-confirm-password" name="password_confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Updating…" : "Update password"}</Button>
    </form>
  );
}

