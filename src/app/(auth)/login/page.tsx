import { LoginForm } from "./login-form";
import { BrandWordmark } from "@/components/brand";

export const metadata = { title: "Sign in — Dr. Kishor's Dentistry CRM" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="flex flex-1 min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandWordmark className="h-16 w-auto mb-3" />
          <p className="text-sm text-sidebar-foreground/70">Clinic CRM · sign in to continue</p>
        </div>
        <LoginForm inactiveError={params.error === "inactive"} />
      </div>
    </div>
  );
}
