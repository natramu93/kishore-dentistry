"use client";

import { useActionState, useState } from "react";
import { login } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
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
  const [passwordVisible, setPasswordVisible] = useState(false);

  const errorMessage =
    state?.error ??
    (inactiveError
      ? "Your account has been deactivated. Contact your administrator."
      : recoveryError
        ? "That invitation or recovery link is invalid or expired. Request a new one."
        : null);
  const formHasError = state?.field === "form" || inactiveError || recoveryError;
  const emailHasError = state?.field === "email" || formHasError;
  const passwordHasError = state?.field === "password" || formHasError;

  return (
    <Card className="rounded-2xl shadow-[0_20px_60px_-32px_rgba(27,36,82,0.5)] ring-black/10">
      <CardContent className="px-5 sm:px-7">
        <form
          action={formAction}
          className="space-y-5"
          aria-label="Sign in to the clinic CRM"
          aria-busy={pending}
          noValidate
        >
          {errorMessage && (
            <div
              id="login-error"
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-3.5 py-3 text-sm leading-relaxed text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
            >
              <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}
          {passwordUpdated && !errorMessage && (
            <p
              role="status"
              className="rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-3 text-sm leading-relaxed"
            >
              Password updated. Sign in with your new password.
            </p>
          )}
          <p id="login-credentials-help" className="text-sm leading-relaxed text-muted-foreground">
            Use the email and password provided by your clinic administrator.
          </p>
          <div className="space-y-2.5">
            <Label htmlFor="email" className="text-foreground">
              Email address
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="next"
              spellCheck={false}
              className="h-12 bg-background px-3.5"
              aria-invalid={emailHasError || undefined}
              aria-describedby={emailHasError ? "login-credentials-help login-error" : "login-credentials-help"}
              required
            />
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="password" className="text-foreground">
                Password
              </Label>
              <Link
                href="/auth/forgot-password"
                className="inline-flex min-h-11 items-center rounded-lg px-1 text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={passwordVisible ? "text" : "password"}
                autoComplete="current-password"
                enterKeyHint="go"
                className="h-12 bg-background px-3.5 pr-12"
                aria-invalid={passwordHasError || undefined}
                aria-describedby={passwordHasError ? "login-credentials-help login-error" : "login-credentials-help"}
                required
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 inline-flex min-h-12 min-w-12 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
                aria-label={passwordVisible ? "Hide password" : "Show password"}
                aria-controls="password"
                aria-pressed={passwordVisible}
                onClick={() => setPasswordVisible((visible) => !visible)}
              >
                {passwordVisible ? (
                  <EyeOff className="size-5" aria-hidden="true" />
                ) : (
                  <Eye className="size-5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={pending}>
            {pending ? (
              <>
                <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              <>
                <LockKeyhole className="size-5" aria-hidden="true" />
                Sign in securely
              </>
            )}
          </Button>
          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            Authorized clinic team members only.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
