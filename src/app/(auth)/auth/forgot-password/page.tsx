import type { Metadata } from "next";
import Link from "next/link";
import { BrandWordmark } from "@/components/brand";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset password — Dr. Kishor's Dentistry CRM",
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandWordmark className="mb-3 h-16 w-auto" preload />
          <h1 className="text-lg font-semibold text-sidebar-foreground">
            Reset your password
          </h1>
          <p className="mt-1 text-sm text-sidebar-foreground/80">
            We will email a short-lived recovery link.
          </p>
        </div>
        <ForgotPasswordForm />
        <p className="mt-4 text-center text-sm">
          <Link
            href="/login"
            className="text-sidebar-foreground underline underline-offset-4"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
