"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getMfaErrorMessage,
  isSafeTotpQrCode,
  normalizeTotpCode,
} from "@/lib/auth/mfa-policy";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MfaFlow =
  | { kind: "loading" }
  | { kind: "needs-enrollment" }
  | { kind: "challenge"; factorId: string }
  | {
      kind: "enrollment";
      factorId: string;
      qrCode: string;
      secret: string;
    };

type LoadedMfaFlow = Exclude<MfaFlow, { kind: "loading" }> | { kind: "complete" };

const GENERIC_SETUP_ERROR =
  "We couldn't prepare two-step verification. Check your connection and try again.";

async function readMfaFlow(
  supabase: ReturnType<typeof createClient>
): Promise<LoadedMfaFlow> {
  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) throw assurance.error;
  if (assurance.data.currentLevel === "aal2") return { kind: "complete" };

  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) throw factors.error;

  const verifiedTotp = factors.data.totp[0];
  return verifiedTotp
    ? { kind: "challenge", factorId: verifiedTotp.id }
    : { kind: "needs-enrollment" };
}

export function MfaForm() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [flow, setFlow] = useState<MfaFlow>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const operationInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    void readMfaFlow(supabase)
      .then((loadedFlow) => {
        if (!active) return;
        if (loadedFlow.kind === "complete") {
          router.replace("/dashboard");
          router.refresh();
          return;
        }
        setFlow(loadedFlow);
      })
      .catch(() => {
        if (active) setError(GENERIC_SETUP_ERROR);
      });
    return () => {
      active = false;
    };
  }, [router, supabase]);

  function retryLoading() {
    setError(null);
    setFlow({ kind: "loading" });
    void readMfaFlow(supabase)
      .then((loadedFlow) => {
        if (loadedFlow.kind === "complete") {
          router.replace("/dashboard");
          router.refresh();
          return;
        }
        setFlow(loadedFlow);
      })
      .catch(() => setError(GENERIC_SETUP_ERROR));
  }

  async function startEnrollment() {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setPending(true);
    setError(null);

    try {
      // Re-read factors at the mutation boundary in case another tab completed
      // enrollment after this page loaded.
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) {
        setError(GENERIC_SETUP_ERROR);
        return;
      }
      const verifiedTotp = factors.data.totp[0];
      if (verifiedTotp) {
        setFlow({ kind: "challenge", factorId: verifiedTotp.id });
        return;
      }

      // An interrupted setup leaves an unverified factor whose secret cannot
      // be recovered. Remove only those stale TOTP factors before starting a
      // fresh enrollment.
      const staleTotpFactors = factors.data.all.filter(
        (factor) =>
          factor.factor_type === "totp" && factor.status === "unverified"
      );
      for (const factor of staleTotpFactors) {
        const removal = await supabase.auth.mfa.unenroll({
          factorId: factor.id,
        });
        if (removal.error) {
          setError(GENERIC_SETUP_ERROR);
          return;
        }
      }

      const enrollment = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "CRM authenticator",
        issuer: "Dr. Kishor's Dentistry CRM",
      });
      if (
        enrollment.error ||
        !isSafeTotpQrCode(enrollment.data.totp.qr_code) ||
        !enrollment.data.totp.secret
      ) {
        if (enrollment.data?.id) {
          await supabase.auth.mfa.unenroll({
            factorId: enrollment.data.id,
          });
        }
        setError(GENERIC_SETUP_ERROR);
        return;
      }

      setFlow({
        kind: "enrollment",
        factorId: enrollment.data.id,
        qrCode: enrollment.data.totp.qr_code,
        secret: enrollment.data.totp.secret,
      });
    } catch {
      setError(GENERIC_SETUP_ERROR);
    } finally {
      operationInFlight.current = false;
      setPending(false);
    }
  }

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      operationInFlight.current ||
      (flow.kind !== "challenge" && flow.kind !== "enrollment")
    ) {
      return;
    }

    const code = normalizeTotpCode(
      String(new FormData(event.currentTarget).get("code") ?? "")
    );
    if (!code) {
      setError("Enter the six-digit code from your authenticator app.");
      return;
    }

    operationInFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const verification = await supabase.auth.mfa.challengeAndVerify({
        factorId: flow.factorId,
        code,
      });
      if (verification.error) {
        setError(getMfaErrorMessage(verification.error));
        return;
      }

      const assurance =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error || assurance.data.currentLevel !== "aal2") {
        setError("Verification did not complete. Enter a new code and try again.");
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("We couldn't verify that code. Check your connection and try again.");
    } finally {
      operationInFlight.current = false;
      setPending(false);
    }
  }

  async function signOut() {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await supabase.auth.signOut({ scope: "local" });
      if (result.error) {
        setError("We couldn't sign you out. Please try again.");
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setError("We couldn't sign you out. Please try again.");
    } finally {
      operationInFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <p className="sr-only" role="status" aria-live="polite">
          {error
            ? ""
            : flow.kind === "needs-enrollment"
            ? "Authenticator setup is required."
            : flow.kind === "enrollment"
              ? "Authenticator setup is ready. Scan the QR code, then enter a code."
              : flow.kind === "challenge"
                ? "Enter a code from your authenticator app."
                : "Checking two-step verification."}
        </p>
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 size-6 shrink-0 text-primary"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            Your role can access sensitive clinic information, so a current
            authenticator code is required.
          </p>
        </div>

        {error && (
          <p
            id="mfa-error"
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        {flow.kind === "loading" && !error && (
          <p className="text-sm">Checking two-step verification&hellip;</p>
        )}

        {flow.kind === "loading" && error && (
          <Button type="button" className="w-full" onClick={retryLoading}>
            Try again
          </Button>
        )}

        {flow.kind === "needs-enrollment" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <h2 className="font-medium">Set up an authenticator app</h2>
              <p className="text-sm text-muted-foreground">
                You can use any app that supports time-based one-time passwords,
                such as Microsoft Authenticator, Google Authenticator, or 1Password.
              </p>
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={pending}
              onClick={() => void startEnrollment()}
            >
              {pending ? "Preparing\u2026" : "Start setup"}
            </Button>
          </div>
        )}

        {flow.kind === "enrollment" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <h2 className="font-medium">Scan the QR code</h2>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Open your authenticator app.</li>
                <li>Add an account and scan this QR code.</li>
                <li>Enter the six-digit code shown by the app.</li>
              </ol>
            </div>
            <div className="flex justify-center rounded-lg border bg-white p-3">
              <Image
                src={flow.qrCode}
                width={208}
                height={208}
                unoptimized
                alt="QR code for adding this CRM account to an authenticator app"
              />
            </div>
            <details className="rounded-lg border px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">
                Can&apos;t scan the QR code?
              </summary>
              <p className="mt-2 text-muted-foreground">
                Enter this setup key manually. Keep it private.
              </p>
              <code className="mt-2 block break-all rounded bg-muted p-2 font-mono text-sm">
                {flow.secret}
              </code>
            </details>
          </div>
        )}

        {(flow.kind === "challenge" || flow.kind === "enrollment") && (
          <form onSubmit={verify} className="space-y-4" noValidate>
            {flow.kind === "challenge" && (
              <div className="space-y-1">
                <h2 className="font-medium">Enter your authenticator code</h2>
                <p className="text-sm text-muted-foreground">
                  Open the authenticator app linked to this account.
                </p>
                <p className="text-sm text-muted-foreground">
                  If you no longer have access to it, contact your administrator
                  to reset the factor.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="mfa-code">Six-digit code</Label>
              <Input
                id="mfa-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "mfa-error" : "mfa-code-help"}
                required
              />
              <p id="mfa-code-help" className="text-sm text-muted-foreground">
                Codes change every 30 seconds.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Verifying\u2026" : "Verify and continue"}
            </Button>
          </form>
        )}

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending}
          onClick={() => void signOut()}
        >
          Sign out
        </Button>
      </CardContent>
    </Card>
  );
}
