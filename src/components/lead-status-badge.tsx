import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS } from "@/lib/leads/transitions";
import type { LeadStatus } from "@/lib/database.types";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<LeadStatus, string> = {
  open: "bg-slate-100 text-slate-700 border-slate-200",
  assigned: "bg-blue-100 text-blue-700 border-blue-200",
  appointment_booked: "bg-violet-100 text-violet-700 border-violet-200",
  visited_treated: "bg-emerald-100 text-emerald-700 border-emerald-200",
  follow_up: "bg-amber-100 text-amber-700 border-amber-200",
  closed: "bg-green-100 text-green-800 border-green-200",
  dropped: "bg-red-100 text-red-700 border-red-200",
  missed: "bg-orange-100 text-orange-700 border-orange-200",
};

export function LeadStatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(STATUS_STYLES[status], className)}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
