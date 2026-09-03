import Link from "next/link";
import { getAuthContext } from "@/lib/auth/context";
import { logout } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandMark, BrandWordmark } from "@/components/brand";
import { DesktopNav, MobileNav } from "@/components/app-nav";
import { PRIMARY_NAV, ADMIN_NAV, navForRole, ROLE_LABELS } from "@/components/nav-items";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  const nav = navForRole(PRIMARY_NAV, ctx.role);
  const adminNav = navForRole(ADMIN_NAV, ctx.role);

  return (
    <div className="flex min-h-svh w-full bg-background">
      <a
        href="#main-content"
        className="sr-only fixed left-3 top-3 z-50 rounded-md bg-background px-4 py-2 font-medium text-foreground shadow-lg focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      {/* Desktop sidebar uses the supplied white-and-gold logo on brand navy. */}
      <aside className="hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="border-b border-sidebar-border p-5">
          <Link
            href="/dashboard"
            className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <BrandWordmark className="h-12" />
          </Link>
        </div>
        <DesktopNav nav={nav} adminNav={adminNav} />
        <div className="border-t border-sidebar-border p-4 space-y-2">
          <div className="text-sm font-medium truncate">{ctx.fullName || ctx.email}</div>
          <Badge className="bg-sidebar-accent text-sidebar-accent-foreground border-transparent">
            {ROLE_LABELS[ctx.role]}
          </Badge>
          <form action={logout}>
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-1 border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              type="submit"
            >
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* The compact mark stays recognizable when space or text zoom is constrained. */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-sidebar-border bg-sidebar px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sidebar-foreground md:hidden">
          <div className="flex items-center gap-2 min-w-0">
            <MobileNav nav={nav} adminNav={adminNav} />
            <Link
              href="/dashboard"
              aria-label="Go to dashboard"
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <BrandMark decorative />
            </Link>
          </div>
          <form action={logout}>
            <Button
              variant="ghost"
              size="sm"
              type="submit"
              className="min-h-11 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              Sign out
            </Button>
          </form>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 outline-none">
          <div className="p-3 md:p-5 max-w-[100rem] mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
