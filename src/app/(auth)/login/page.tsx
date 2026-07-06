import { LoginForm } from "./login-form";
import { ToothMark } from "@/components/brand";

export const metadata = { title: "Sign in — Dr. Kishor's Dentistry CRM" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="flex flex-1 min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <ToothMark className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Dr. Kishor&apos;s Dentistry</h1>
          <p className="text-sm text-muted-foreground mt-1">Clinic CRM · sign in to continue</p>
        </div>
        <LoginForm inactiveError={params.error === "inactive"} />
      </div>
    </div>
  );
}
