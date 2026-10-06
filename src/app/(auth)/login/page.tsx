import { LoginForm } from "./login-form";
import { BrandWordmark } from "@/components/brand";
import { TIRUPUR_CLINIC } from "@/lib/clinic";
import { ShieldCheck } from "lucide-react";

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
    <main className="min-h-svh w-full flex-1 overflow-x-hidden bg-background lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(28rem,0.92fr)]">
      <section
        aria-label={`About ${TIRUPUR_CLINIC.brandName}`}
        className="flex min-h-64 items-center bg-brand-navy px-5 py-8 sm:min-h-80 sm:px-8 sm:py-10 lg:min-h-svh lg:px-10 xl:px-14"
      >
        <div className="mx-auto w-full max-w-2xl text-white lg:mx-0">
          <div className="inline-flex rounded-2xl bg-white/5 p-2.5 ring-1 ring-white/20 sm:p-3">
            <BrandWordmark className="h-10 w-auto sm:h-14 lg:h-16" />
          </div>
          <p className="mt-6 text-xs font-semibold tracking-[0.18em] text-gold uppercase sm:mt-8 sm:text-sm">
            {TIRUPUR_CLINIC.brandName} · Tirupur
          </p>
          <p className="mt-2 max-w-xl text-2xl leading-tight font-semibold text-balance sm:text-3xl lg:text-4xl xl:text-5xl">
            One place for every patient journey.
          </p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">
            Secure access to appointments, patient communication, and clinical records for the team at {TIRUPUR_CLINIC.brandName}.
          </p>
        </div>
      </section>

      <section
        aria-labelledby="login-heading"
        className="relative flex items-center justify-center px-4 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-12 lg:px-10 xl:px-16"
      >
        <div className="w-full max-w-md">
          <header className="mb-6">
            <div className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3.5 py-2 text-sm font-semibold text-foreground">
              <ShieldCheck className="size-4" aria-hidden="true" />
              Secure staff portal
            </div>
            <h1 id="login-heading" className="text-3xl leading-tight font-semibold tracking-tight text-foreground sm:text-4xl">
              Welcome back
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Sign in to continue to the Tirupur clinic workspace.
            </p>
          </header>

          <LoginForm
            inactiveError={params.error === "inactive"}
            recoveryError={params.error === "recovery"}
            passwordUpdated={params.password === "updated"}
          />
        </div>
      </section>
    </main>
  );
}
