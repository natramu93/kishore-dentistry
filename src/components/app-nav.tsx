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
  Building2, UserCog, Stethoscope, Megaphone, ClipboardList, BarChart3,
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
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon className="h-4 w-4 shrink-0 text-gold" />
        {item.label}
      </Link>
    );
  };

  return (
    <nav className="flex-1 space-y-1 p-2">
      {nav.map(renderItem)}
      {adminNav.length > 0 && (
        <>
          <p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-gold">
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
            size="icon-sm"
            aria-label="Open menu"
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Menu className="h-5 w-5" />
          </Button>
        }
      />
      <SheetContent side="left" className="w-64 p-0 flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border">
        <div className="border-b p-4">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <BrandWordmark />
        </div>
        <NavList nav={nav} adminNav={adminNav} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
