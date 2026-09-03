import { LoginForm } from "./login-form";
import { BrandWordmark } from "@/components/brand";
import { ClinicContactDetails } from "@/components/clinic-contact-details";
import { TIRUPUR_CLINIC } from "@/lib/clinic";
import { ShieldCheck } from "lucide-react";
import Image from "next/image";

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
        className="relative min-h-40 overflow-hidden bg-brand-navy sm:min-h-80 lg:min-h-svh"
      >
        <Image
          src="/images/login/tirupur-branch-team.webp"
          alt={`Clinical team at ${TIRUPUR_CLINIC.brandName}, Tirupur`}
          fill
          sizes="(max-width: 1023px) 100vw, 54vw"
          className="object-cover object-center lg:object-contain"
          preload
        />
        <div
          className="absolute inset-0 bg-gradient-to-b from-brand-navy/80 via-brand-blue/20 to-brand-navy/95"
          aria-hidden="true"
        />
        <div className="relative flex min-h-40 flex-col p-4 sm:min-h-80 sm:p-8 lg:min-h-svh lg:p-10 xl:p-14">
          <div className="inline-flex self-start rounded-2xl bg-brand-navy p-2.5 shadow-xl ring-1 ring-white/20 sm:p-3">
            <BrandWordmark className="h-10 w-auto sm:h-14 lg:h-16" />
          </div>
          <div className="absolute top-10 right-10 hidden h-36 w-56 overflow-hidden rounded-2xl border-4 border-gold/80 shadow-2xl xl:block 2xl:right-14 2xl:h-40 2xl:w-64">
            <Image
              src="/images/login/tirupur-dental-operatory.jpg"
              alt=""
              fill
              sizes="256px"
              className="object-cover"
            />
          </div>
          <div className="mt-auto max-w-2xl text-white">
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-gold uppercase sm:text-sm">
              {TIRUPUR_CLINIC.brandName} · Tirupur
            </p>
            <p className="hidden max-w-xl text-3xl leading-tight font-semibold text-balance sm:block lg:text-4xl xl:text-5xl">
              One place for every patient journey.
            </p>
            <p className="mt-3 hidden max-w-xl text-sm leading-relaxed text-white/85 sm:block lg:text-base">
              Secure access to appointments, patient communication, and clinical records for the team at {TIRUPUR_CLINIC.brandName}.
            </p>
          </div>
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

          <ClinicContactDetails
            className="mt-6 rounded-2xl border border-border bg-card/85 p-4 text-foreground shadow-sm backdrop-blur-sm sm:p-5"
            showName={false}
          />
        </div>
      </section>
    </main>
  );
}
