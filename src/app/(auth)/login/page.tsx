import { LoginForm } from "./login-form";
import { BrandWordmark } from "@/components/brand";
import { ClinicContactDetails } from "@/components/clinic-contact-details";
import { TIRUPUR_CLINIC } from "@/lib/clinic";

export const metadata = {
  title: `Sign in — ${TIRUPUR_CLINIC.brandName} CRM`,
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; password?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="flex min-h-svh flex-1 items-center justify-start overflow-y-auto bg-sidebar p-4 py-8 sm:justify-center">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandWordmark className="mb-3 h-16 w-auto" preload />
          <h1 className="text-lg font-semibold text-sidebar-foreground">Sign in</h1>
          <p className="mt-1 text-sm text-sidebar-foreground/80">Clinic CRM · continue to your workspace</p>
        </div>
        <LoginForm
          inactiveError={params.error === "inactive"}
          recoveryError={params.error === "recovery"}
          passwordUpdated={params.password === "updated"}
        />
        <ClinicContactDetails className="mt-6 rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-4 text-sidebar-foreground" />
      </div>
    </main>
  );
}
