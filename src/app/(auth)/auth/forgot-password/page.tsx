import type { Metadata } from "next";
import Link from "next/link";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset password — Dr. Kishor's Dentistry CRM",
};

export default function ForgotPasswordPage() {
  return (
    <AuthPageShell
      title="Reset your password"
      description="We will email a short-lived recovery link."
      footer={
        <p>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center rounded-md px-2 text-sidebar-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/60"
          >
            Back to sign in
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthPageShell>
  );
}
