import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DesktopNav } from "@/components/app-nav";
import type { NavItem } from "@/components/nav-items";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

afterEach(cleanup);

const nav: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: "LayoutDashboard",
    roles: ["admin"],
  },
];

const adminNav: NavItem[] = Array.from({ length: 12 }, (_, index) => ({
  href: `/admin/item-${index + 1}`,
  label: `Admin item ${index + 1}`,
  icon: "UserCog",
  roles: ["admin"],
}));

describe("application navigation", () => {
  it("keeps long navigation lists scrollable in constrained-height shells", () => {
    render(<DesktopNav nav={nav} adminNav={adminNav} />);

    expect(screen.getByRole("navigation", { name: "Main navigation" })).toHaveClass(
      "min-h-0",
      "overflow-y-auto",
      "overscroll-contain"
    );
  });

  it("identifies the current page with a high-contrast visual rail and semantics", () => {
    render(<DesktopNav nav={nav} adminNav={[]} />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveClass(
      "border-l-4",
      "border-l-gold"
    );
  });
});
