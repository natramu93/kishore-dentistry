import type { Metadata } from "next";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { ResetPasswordForm } from "../../reset-password/reset-password-form";

export const metadata: Metadata = {
  title: "Set your password — Dr. Kishor's Dentistry CRM",
};

export default function SetPasswordPage() {
  return (
    <AuthPageShell
      title="Finish setting up your account"
      description="Choose a unique password of at least 12 characters."
    >
      <ResetPasswordForm />
    </AuthPageShell>
  );
}
