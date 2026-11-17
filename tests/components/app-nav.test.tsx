import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DesktopNav, MobileNav } from "@/components/app-nav";
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
  it("opens primary and admin menu items in the current desktop tab", () => {
    render(<DesktopNav nav={nav} adminNav={adminNav} />);
    const links = within(screen.getByRole("navigation", { name: "Main navigation" })).getAllByRole("link");
    expect(links).toHaveLength(nav.length + adminNav.length);
    for (const link of links) expect(link).toHaveAttribute("target", "_self");
  });

  it("opens mobile drawer links in the current tab", async () => {
    render(<MobileNav nav={nav} adminNav={adminNav} fullName="Example User" email="example@example.test"
      roleLabel="Admin" logoutAction={async () => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    const links = within(drawer).getAllByRole("link");
    expect(links).toHaveLength(nav.length + adminNav.length + 2);
    for (const link of links) expect(link).toHaveAttribute("target", "_self");
  });

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
