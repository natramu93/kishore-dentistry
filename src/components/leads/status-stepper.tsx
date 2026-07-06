import { PIPELINE_ORDER, STATUS_LABELS } from "@/lib/leads/transitions";
import type { LeadStatus } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

export function StatusStepper({ status }: { status: LeadStatus }) {
  const isTerminalBad = status === "dropped" || status === "missed";
  const currentIdx = PIPELINE_ORDER.indexOf(status);

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {PIPELINE_ORDER.map((s, i) => {
        const done = currentIdx > i || status === "closed";
        const current = s === status;
        return (
          <div key={s} className="flex items-center gap-1 shrink-0">
            {i > 0 && <div className={cn("h-px w-4 md:w-8", done ? "bg-primary" : "bg-border")} />}
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                current
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "text-muted-foreground"
              )}
            >
              {done && !current && <Check className="h-3 w-3" />}
              {STATUS_LABELS[s]}
            </div>
          </div>
        );
      })}
      {isTerminalBad && (
        <div className="flex items-center gap-1 shrink-0">
          <div className="h-px w-4 md:w-8 bg-destructive/40" />
          <div className="flex items-center gap-1.5 rounded-full border border-destructive bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
            <X className="h-3 w-3" />
            {STATUS_LABELS[status]}
          </div>
        </div>
      )}
    </div>
  );
}
