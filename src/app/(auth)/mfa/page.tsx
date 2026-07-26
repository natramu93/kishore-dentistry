import type { Metadata } from "next";
import { BrandWordmark } from "@/components/brand";
import { getMfaSetupContext } from "@/lib/auth/context";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = {
  title: "Two-step verification — Dr. Kishor's Dentistry CRM",
};

export default async function MfaPage() {
  const context = await getMfaSetupContext();

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandWordmark className="mb-3 h-16 w-auto" preload />
          <h1 className="text-lg font-semibold text-sidebar-foreground">
            Two-step verification
          </h1>
          <p className="mt-1 text-sm text-sidebar-foreground/80">
            Signed in as {context.email}
          </p>
        </div>
        <MfaForm />
      </div>
    </main>
  );
}
