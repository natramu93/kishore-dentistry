import type { UserRole } from "@/lib/database.types";

export type NavItem = {
  href: string;
  label: string;
  icon: string; // lucide icon name, resolved client-side
  roles: UserRole[];
};

// Front Office = reception/intake. Operations = branch business management.
// Clinical Head = senior clinical oversight (full pipeline + the treatment
// catalog/doctor roster). Doctor = self-scoped to their own schedule.
export const PRIMARY_NAV: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: "LayoutDashboard",
    roles: ["admin", "operations", "front_office", "clinical_head", "doctor"],
  },
  {
    href: "/leads",
    label: "Leads",
    icon: "Users",
    roles: ["admin", "operations", "front_office", "clinical_head"],
  },
  {
    href: "/appointments",
    label: "Appointments",
    icon: "CalendarDays",
    roles: ["admin", "operations", "front_office", "clinical_head", "doctor"],
  },
  {
    href: "/follow-ups",
    label: "Follow-ups",
    icon: "BellRing",
    roles: ["admin", "operations", "front_office", "clinical_head"],
  },
  {
    href: "/invoices",
    label: "Invoices",
    icon: "ReceiptText",
    roles: ["admin", "operations", "front_office", "clinical_head"],
  },
  {
    href: "/reports",
    label: "Reports",
    icon: "BarChart3",
    roles: ["admin", "operations", "clinical_head"],
  },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/branches", label: "Branches", icon: "Building2", roles: ["admin"] },
  { href: "/admin/users", label: "Users", icon: "UserCog", roles: ["admin"] },
  {
    href: "/admin/doctors",
    label: "Doctors",
    icon: "Stethoscope",
    roles: ["admin", "operations", "clinical_head"],
  },
  { href: "/admin/sources", label: "Lead Sources", icon: "Megaphone", roles: ["admin"] },
  {
    href: "/admin/treatments",
    label: "Treatments",
    icon: "ClipboardList",
    roles: ["admin", "clinical_head"],
  },
];

export function navForRole(items: NavItem[], role: UserRole): NavItem[] {
  return items.filter((n) => n.roles.includes(role));
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  operations: "Operations",
  front_office: "Front Office",
  clinical_head: "Clinical Head",
  doctor: "Doctor",
};
