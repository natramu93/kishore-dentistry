import type { Metadata } from "next";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password — Dr. Kishor's Dentistry CRM",
};

export default function ResetPasswordPage() {
  return (
    <AuthPageShell
      title="Choose a new password"
      description="Use at least 12 characters and do not reuse a password."
    >
      <ResetPasswordForm />
    </AuthPageShell>
  );
}
