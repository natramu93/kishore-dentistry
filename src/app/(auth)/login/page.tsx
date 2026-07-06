import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Kishore Dentistry CRM" };

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
          <h1 className="text-2xl font-bold tracking-tight">Kishore Dentistry</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sign in to the clinic CRM
          </p>
        </div>
        <LoginForm inactiveError={params.error === "inactive"} />
      </div>
    </div>
  );
}
