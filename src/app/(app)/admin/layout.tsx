import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  // Agents have no admin area; managers only reach /admin/doctors (page-level check)
  if (ctx.role === "agent") redirect("/dashboard");
  return <>{children}</>;
}
