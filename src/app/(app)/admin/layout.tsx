import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  // Front Office and Doctor logins have no admin area at all. Operations and
  // Operations and Clinical Head rely on page-level role and center-scope checks.
  if (ctx.role === "front_office" || ctx.role === "doctor") redirect("/dashboard");
  return <>{children}</>;
}
