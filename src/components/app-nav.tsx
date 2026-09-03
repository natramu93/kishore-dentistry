"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  BarChart3,
  BookUser,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { BrandWordmark } from "@/components/brand";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/components/nav-items";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Users, CalendarDays, BellRing, ReceiptText,
  Building2, UserCog, Stethoscope, Megaphone, ClipboardList, BarChart3, BookUser,
};

function NavList({
  nav,
  adminNav,
  onNavigate,
}: {
  nav: NavItem[];
  adminNav: NavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const renderItem = (item: NavItem) => {
    const Icon = ICONS[item.icon] ?? LayoutDashboard;
    const active = pathname === item.href || pathname.startsWith(item.href + "/");
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-lg border-l-4 border-l-transparent px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset",
          active
            ? "border-l-gold bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-gold" />
        {item.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main navigation"
      className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      {nav.map(renderItem)}
      {adminNav.length > 0 && (
        <>
          <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/80">
            Administration
          </p>
          {adminNav.map(renderItem)}
        </>
      )}
    </nav>
  );
}

/** Desktop sidebar nav (always visible ≥ md). */
export function DesktopNav({ nav, adminNav }: { nav: NavItem[]; adminNav: NavItem[] }) {
  return <NavList nav={nav} adminNav={adminNav} />;
}

/** Mobile hamburger that opens a slide-out drawer with the same nav. */
export function MobileNav({ nav, adminNav }: { nav: NavItem[]; adminNav: NavItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Open menu"
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Menu className="h-5 w-5" />
          </Button>
        }
      />
      <SheetContent side="left" className="flex w-72 max-w-[85vw] flex-col border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
        <div className="border-b border-sidebar-border p-5 pr-16">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <BrandWordmark className="h-12" />
          </Link>
        </div>
        <NavList nav={nav} adminNav={adminNav} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
