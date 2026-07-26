import { PIPELINE_ORDER, STATUS_LABELS } from "@/lib/leads/transitions";
import type { LeadStatus } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

export function StatusStepper({ status }: { status: LeadStatus }) {
  const isTerminalBad = status === "dropped" || status === "missed";
  const currentIdx = PIPELINE_ORDER.indexOf(status);

  return (
    <ol
      aria-label="Lead progress"
      className="flex items-center gap-1 overflow-x-auto rounded-lg pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
    >
      {PIPELINE_ORDER.map((s, i) => {
        const done = currentIdx > i || status === "closed";
        const current = s === status;
        return (
          <li key={s} className="flex shrink-0 items-center gap-1">
            {i > 0 && (
              <span
                aria-hidden="true"
                className={cn("h-px w-4 md:w-8", done ? "bg-primary" : "bg-border")}
              />
            )}
            <div
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                current
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "text-muted-foreground"
              )}
            >
              {done && !current && <Check aria-hidden="true" className="h-3 w-3" />}
              {STATUS_LABELS[s]}
              {current && <span className="sr-only">, current stage</span>}
              {done && !current && <span className="sr-only">, completed</span>}
            </div>
          </li>
        );
      })}
      {isTerminalBad && (
        <li className="flex shrink-0 items-center gap-1">
          <span aria-hidden="true" className="h-px w-4 bg-destructive/40 md:w-8" />
          <div
            aria-current="step"
            className="flex items-center gap-1.5 rounded-full border border-destructive bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive"
          >
            <X aria-hidden="true" className="h-3 w-3" />
            {STATUS_LABELS[status]}
            <span className="sr-only">, current stage</span>
          </div>
        </li>
      )}
    </ol>
  );
}
