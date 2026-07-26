import type { Metadata } from "next";
import { BrandWordmark } from "@/components/brand";
import { ResetPasswordForm } from "../../reset-password/reset-password-form";

export const metadata: Metadata = {
  title: "Set your password — Dr. Kishor's Dentistry CRM",
};

export default function SetPasswordPage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandWordmark className="mb-3 h-16 w-auto" preload />
          <h1 className="text-lg font-semibold text-sidebar-foreground">
            Finish setting up your account
          </h1>
          <p className="mt-1 text-sm text-sidebar-foreground/80">
            Choose a unique password of at least 12 characters.
          </p>
        </div>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
