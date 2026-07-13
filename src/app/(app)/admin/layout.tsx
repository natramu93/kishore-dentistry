import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  // Front Office and Doctor logins have no admin area at all. Operations and
  // Clinical Head reach only /admin/doctors + /admin/treatments (page-level checks).
  if (ctx.role === "front_office" || ctx.role === "doctor") redirect("/dashboard");
  return <>{children}</>;
}
