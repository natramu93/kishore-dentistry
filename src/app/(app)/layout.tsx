import { getAuthContext } from "@/lib/auth/context";
import { logout } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandWordmark } from "@/components/brand";
import { DesktopNav, MobileNav } from "@/components/app-nav";
import { PRIMARY_NAV, ADMIN_NAV, navForRole } from "@/components/nav-items";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  const nav = navForRole(PRIMARY_NAV, ctx.role);
  const adminNav = navForRole(ADMIN_NAV, ctx.role);

  return (
    <div className="flex min-h-screen w-full">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 flex-col border-r bg-sidebar">
        <div className="p-4 border-b">
          <BrandWordmark />
        </div>
        <DesktopNav nav={nav} adminNav={adminNav} />
        <div className="border-t p-4 space-y-2">
          <div className="text-sm font-medium truncate">{ctx.fullName || ctx.email}</div>
          <Badge variant="secondary" className="capitalize">{ctx.role}</Badge>
          <form action={logout}>
            <Button variant="outline" size="sm" className="w-full mt-1" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar with hamburger drawer */}
        <header className="md:hidden sticky top-0 z-30 flex items-center justify-between border-b bg-background/95 backdrop-blur px-3 py-2">
          <div className="flex items-center gap-2">
            <MobileNav nav={nav} adminNav={adminNav} />
            <BrandWordmark subtitle={null} />
          </div>
          <form action={logout}>
            <Button variant="ghost" size="sm" type="submit">Sign out</Button>
          </form>
        </header>

        <main className="flex-1 min-w-0">
          <div className="p-4 md:p-8 max-w-7xl mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
