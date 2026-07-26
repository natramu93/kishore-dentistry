"use client";

import { useActionState } from "react";
import { login } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";
import Link from "next/link";

export function LoginForm({
  inactiveError,
  recoveryError,
  passwordUpdated,
}: {
  inactiveError?: boolean;
  recoveryError?: boolean;
  passwordUpdated?: boolean;
}) {
  const [state, formAction, pending] = useActionState(login, null);

  const errorMessage =
    state?.error ??
    (inactiveError
      ? "Your account has been deactivated. Contact your administrator."
      : recoveryError
        ? "That invitation or recovery link is invalid or expired. Request a new one."
        : null);

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4" noValidate>
          {errorMessage && (
            <div
              id="login-error"
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
          {passwordUpdated && !errorMessage && (
            <p
              role="status"
              className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
            >
              Password updated. Sign in with your new password.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              aria-invalid={state?.field === "email" || state?.field === "form" || undefined}
              aria-describedby={errorMessage ? "login-error" : undefined}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={state?.field === "password" || state?.field === "form" || undefined}
              aria-describedby={errorMessage ? "login-error" : undefined}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-sm">
            <Link
              href="/auth/forgot-password"
              className="underline underline-offset-4"
            >
              Forgot your password?
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
