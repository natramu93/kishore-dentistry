"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordForm() {
  const router = useRouter();
  // Constructing the browser client starts Supabase's implicit-link detection.
  // This must happen before an invited user submits a password because admin
  // invitation links do not support PKCE.
  const [supabase] = useState(() => createClient());
  const [sessionState, setSessionState] = useState<
    "loading" | "valid" | "invalid"
  >("loading");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signOutWarning, setSignOutWarning] = useState<{
    localSignedOut: boolean;
    message: string;
  } | null>(null);
  const operationInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    void supabase.auth
      .getUser()
      .then(({ data, error: authError }) => {
        if (!active) return;
        setSessionState(!authError && data.user ? "valid" : "invalid");
      })
      .catch(() => {
        if (active) setSessionState("invalid");
      });
    return () => {
      active = false;
    };
  }, [supabase]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (operationInFlight.current) return;
    if (sessionState !== "valid") {
      setError(
        "This link is invalid or expired. Request a new invitation or recovery link."
      );
      return;
    }
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("password_confirmation") ?? "");
    if (password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    operationInFlight.current = true;
    setPending(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(
          "This recovery link is invalid or expired. Request a new link and try again."
        );
        return;
      }

      let globalSignOutFailed = false;
      try {
        const globalSignOut = await supabase.auth.signOut({ scope: "global" });
        globalSignOutFailed = Boolean(globalSignOut.error);
      } catch {
        globalSignOutFailed = true;
      }

      if (globalSignOutFailed) {
        let localSignedOut = false;
        try {
          const localSignOut = await supabase.auth.signOut({ scope: "local" });
          localSignedOut = !localSignOut.error;
        } catch {
          localSignedOut = false;
        }

        setSessionState("invalid");
        setSignOutWarning({
          localSignedOut,
          message: localSignedOut
            ? "Your password was updated and this device was signed out, but other sessions could not be revoked. Contact your administrator before signing in again."
            : "Your password was updated, but automatic sign-out failed. Close this browser and contact your administrator immediately.",
        });
        return;
      }

      router.replace("/login?password=updated");
      router.refresh();
    } catch {
      setError(
        "We couldn't update your password. Check your connection and try again."
      );
    } finally {
      operationInFlight.current = false;
      setPending(false);
    }
  }

  async function retryLocalSignOut() {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setPending(true);
    try {
      const localSignOut = await supabase.auth.signOut({ scope: "local" });
      if (localSignOut.error) throw localSignOut.error;
      setSignOutWarning({
        localSignedOut: true,
        message:
          "This device is now signed out, but other sessions could not be revoked. Contact your administrator before signing in again.",
      });
    } catch {
      setSignOutWarning({
        localSignedOut: false,
        message:
          "Automatic sign-out still failed. Close this browser and contact your administrator immediately.",
      });
    } finally {
      operationInFlight.current = false;
      setPending(false);
    }
  }

  if (signOutWarning) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p role="alert" className="text-sm text-destructive">
            {signOutWarning.message}
          </p>
          {signOutWarning.localSignedOut ? (
            <Button
              type="button"
              size="lg"
              className="w-full"
              onClick={() => router.replace("/login")}
            >
              Return to sign in
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={pending}
              onClick={() => void retryLocalSignOut()}
            >
              {pending ? "Signing out\u2026" : "Try signing out again"}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={submit} className="space-y-4">
          {sessionState === "loading" && (
            <p role="status" aria-live="polite" className="text-sm">
              Verifying your secure link&hellip;
            </p>
          )}
          {sessionState === "invalid" && !error && (
            <p id="reset-session-error" role="alert" className="text-sm text-destructive">
              This link is invalid or expired. Request a new invitation or
              recovery link.
            </p>
          )}
          {error && (
            <p id="reset-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              aria-describedby={
                error
                  ? "reset-error"
                  : sessionState === "invalid"
                    ? "reset-session-error"
                    : undefined
              }
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              name="password_confirmation"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              aria-describedby={
                error
                  ? "reset-error"
                  : sessionState === "invalid"
                    ? "reset-session-error"
                    : undefined
              }
              required
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={pending || sessionState !== "valid"}
          >
            {pending ? "Updating…" : "Update password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
