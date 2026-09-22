import Link from "next/link";
import { getAuthContext } from "@/lib/auth/context";
import { logout } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandMark, BrandWordmark } from "@/components/brand";
import { DesktopNav, MobileNav } from "@/components/app-nav";
import { PRIMARY_NAV, ADMIN_NAV, navForRole, ROLE_LABELS } from "@/components/nav-items";
import { IdleTimeoutWatcher } from "@/components/auth/idle-timeout-watcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  const nav = navForRole(PRIMARY_NAV, ctx.role);
  const adminNav = navForRole(ADMIN_NAV, ctx.role);

  return (
    <div className="flex h-svh w-full overflow-hidden bg-background">
      <IdleTimeoutWatcher />
      <a
        href="#main-content"
        className="sr-only fixed left-3 top-3 z-50 rounded-md bg-background px-4 py-2 font-medium text-foreground shadow-lg focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      {/* Desktop sidebar uses the supplied white-and-gold logo on brand navy. */}
      <aside className="hidden h-svh w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="border-b border-sidebar-border p-5">
          <Link
            href="/dashboard"
            className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <BrandWordmark className="h-12" />
          </Link>
        </div>
        <DesktopNav nav={nav} adminNav={adminNav} />
        <div className="space-y-2 border-t border-sidebar-border p-4">
          <Link href="/profile" className="block rounded-md px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
            <div className="truncate text-sm font-medium">{ctx.fullName || ctx.email}</div>
            <div className="text-xs text-sidebar-foreground/75">My profile</div>
          </Link>
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* The compact mark stays recognizable when space or text zoom is constrained. */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-sidebar-border bg-sidebar px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sidebar-foreground md:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNav nav={nav} adminNav={adminNav} fullName={ctx.fullName} email={ctx.email} roleLabel={ROLE_LABELS[ctx.role]} logoutAction={logout} />
            <Link
              href="/dashboard"
              aria-label="Go to dashboard"
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <BrandMark decorative />
            </Link>
          </div>
          <Link href="/profile" className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">Profile</Link>
        </header>

        <main id="main-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain outline-none">
          <div className="mx-auto w-full max-w-[100rem] p-3 md:p-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
