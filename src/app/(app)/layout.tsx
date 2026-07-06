import Link from "next/link";
import { getAuthContext } from "@/lib/auth/context";
import { logout } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  BellRing,
  ReceiptText,
  Building2,
  UserCog,
  Stethoscope,
  Megaphone,
  ClipboardList,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "manager", "agent"] },
  { href: "/leads", label: "Leads", icon: Users, roles: ["admin", "manager", "agent"] },
  { href: "/appointments", label: "Appointments", icon: CalendarDays, roles: ["admin", "manager", "agent"] },
  { href: "/follow-ups", label: "Follow-ups", icon: BellRing, roles: ["admin", "manager", "agent"] },
  { href: "/invoices", label: "Invoices", icon: ReceiptText, roles: ["admin", "manager", "agent"] },
] as const;

const ADMIN_NAV = [
  { href: "/admin/branches", label: "Branches", icon: Building2, roles: ["admin"] },
  { href: "/admin/users", label: "Users", icon: UserCog, roles: ["admin"] },
  { href: "/admin/doctors", label: "Doctors", icon: Stethoscope, roles: ["admin", "manager"] },
  { href: "/admin/sources", label: "Lead Sources", icon: Megaphone, roles: ["admin"] },
  { href: "/admin/treatments", label: "Treatments", icon: ClipboardList, roles: ["admin"] },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();

  const nav = NAV.filter((n) => (n.roles as readonly string[]).includes(ctx.role));
  const adminNav = ADMIN_NAV.filter((n) => (n.roles as readonly string[]).includes(ctx.role));

  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden md:flex w-60 flex-col border-r bg-muted/30">
        <div className="p-4 border-b">
          <Link href="/dashboard" className="font-bold text-lg tracking-tight">
            Kishore Dentistry
          </Link>
          <p className="text-xs text-muted-foreground">Clinic CRM</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
          {adminNav.length > 0 && (
            <>
              <p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase text-muted-foreground/70">
                Administration
              </p>
              {adminNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </nav>
        <div className="border-t p-4 space-y-2">
          <div className="text-sm font-medium truncate">{ctx.fullName || ctx.email}</div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="capitalize">{ctx.role}</Badge>
          </div>
          <form action={logout}>
            <Button variant="outline" size="sm" className="w-full" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="md:hidden border-b p-3 flex items-center justify-between">
          <Link href="/dashboard" className="font-bold">Kishore Dentistry</Link>
          <form action={logout}>
            <Button variant="ghost" size="sm" type="submit">Sign out</Button>
          </form>
        </div>
        <div className="p-4 md:p-8 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
