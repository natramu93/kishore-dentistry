import type { UserRole } from "@/lib/database.types";

export type NavItem = {
  href: string;
  label: string;
  icon: string; // lucide icon name, resolved client-side
  roles: UserRole[];
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", roles: ["admin", "manager", "agent"] },
  { href: "/leads", label: "Leads", icon: "Users", roles: ["admin", "manager", "agent"] },
  { href: "/appointments", label: "Appointments", icon: "CalendarDays", roles: ["admin", "manager", "agent"] },
  { href: "/follow-ups", label: "Follow-ups", icon: "BellRing", roles: ["admin", "manager", "agent"] },
  { href: "/invoices", label: "Invoices", icon: "ReceiptText", roles: ["admin", "manager", "agent"] },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/branches", label: "Branches", icon: "Building2", roles: ["admin"] },
  { href: "/admin/users", label: "Users", icon: "UserCog", roles: ["admin"] },
  { href: "/admin/doctors", label: "Doctors", icon: "Stethoscope", roles: ["admin", "manager"] },
  { href: "/admin/sources", label: "Lead Sources", icon: "Megaphone", roles: ["admin"] },
  { href: "/admin/treatments", label: "Treatments", icon: "ClipboardList", roles: ["admin"] },
];

export function navForRole(items: NavItem[], role: UserRole): NavItem[] {
  return items.filter((n) => n.roles.includes(role));
}
