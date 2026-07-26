import { LoginForm } from "./login-form";
import { BrandWordmark } from "@/components/brand";

export const metadata = { title: "Sign in — Dr. Kishor's Dentistry CRM" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; password?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="flex flex-1 min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm">
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
      </div>
    </main>
  );
}
