import { cn } from "@/lib/utils";
import { describeIndianTooth, isPrimaryIndianTooth } from "@/lib/clinical";

type ToothChartProps = {
  teeth: readonly string[];
  selected: string | readonly string[] | null;
  arch: "upper" | "lower";
  onSelect: (tooth: string) => void;
  documentedTeeth?: readonly string[];
  selectableTeeth?: readonly string[];
  columns?: number;
  showMidline?: boolean;
  startColumn?: number;
  fit?: boolean;
};

type ToothKind = "incisor" | "canine" | "premolar" | "molar";

// Original scalable buccal illustrations: roots point away from the bite plane.
// These are selection symbols, not diagnostic radiographs or patient anatomy.
const TOOTH_PATHS: Record<ToothKind, string> = {
  incisor: "M20 3C16 10 17 25 15 40L12 51Q10 60 12 70Q20 74 28 70Q30 60 28 51L25 40C23 24 24 10 20 3Z",
  canine: "M20 2C14 14 16 29 13 45Q9 55 11 66L20 74L29 66Q31 55 27 45C24 29 26 14 20 2Z",
  premolar: "M14 4C10 13 14 27 13 40L10 51Q8 61 11 70Q15 74 20 71Q25 74 29 70Q32 61 30 51L27 40C26 27 30 13 26 4Q22 15 20 31Q18 15 14 4Z",
  molar: "M8 5C5 14 10 28 10 40L6 51Q3 61 7 70Q12 75 18 71Q22 75 27 72Q35 74 35 63L33 51L29 40C32 25 37 12 32 4Q26 17 25 34L22 12Q20 7 18 13L16 34Q13 16 8 5Z",
};
const LOWER_MOLAR = "M8 5C5 18 12 32 11 42L7 51Q3 62 7 71Q13 75 19 71Q25 75 33 71Q37 62 33 51L29 42C28 30 35 15 32 4Q25 15 22 36L18 36Q14 16 8 5Z";

function toothKind(tooth: string): ToothKind {
  const position = Number(tooth[1]);
  if (position <= 2) return "incisor";
  if (position === 3) return "canine";
  if (isPrimaryIndianTooth(tooth)) return "molar";
  if (position <= 5) return "premolar";
  return "molar";
}

function ToothImage({ tooth, arch }: { tooth: string; arch: "upper" | "lower" }) {
  const kind = toothKind(tooth);
  const primary = isPrimaryIndianTooth(tooth);
  const mirror = ["2", "3", "6", "7"].includes(tooth[0]);
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 40 78" data-tooth-kind={kind}
      className={cn("w-8 overflow-visible", primary ? "h-14" : "h-16")}>
      <g transform={arch === "lower" ? "translate(0 78) scale(1 -1)" : undefined}>
      <g transform={mirror ? "translate(40 0) scale(-1 1)" : undefined}>
        <path
          d={kind === "molar" && arch === "lower" ? LOWER_MOLAR : TOOTH_PATHS[kind]}
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="fill-stone-50 group-aria-pressed:fill-primary/15 dark:fill-slate-900"
        />
        <path
          d={kind === "molar" ? "M8 52Q20 57 32 52M12 64L16 61L20 65L25 61L30 64M18 56L20 65" : kind === "premolar" ? "M12 52Q20 56 28 52M15 66L20 63L25 66" : "M14 52Q20 55 26 52M15 68Q20 69 25 68"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          opacity=".5"
          vectorEffect="non-scaling-stroke"
        />
      </g>
      </g>
    </svg>
  );
}

export function ToothChart({
  teeth,
  selected,
  arch,
  onSelect,
  documentedTeeth = [],
  selectableTeeth,
  columns,
  showMidline = true,
  startColumn = 1,
  fit = false,
}: ToothChartProps) {
  const quadrantLength = teeth.length / 2;
  const documented = new Set(documentedTeeth);
  const selectedTeeth = new Set(
    Array.isArray(selected) ? selected : selected ? [selected] : []
  );

  return (
    <div
      className={cn("grid min-w-0 gap-0.5", fit && "@container/tooth-row gap-0")}
      // Keep every arch on ONE line at every width, including narrow invoice panels.
      style={{ gridTemplateColumns: `repeat(${columns ?? teeth.length}, minmax(${fit ? "0" : "2.75rem"}, 1fr))` }}
    >
      {teeth.map((tooth, index) => {
        const isSelected = selectedTeeth.has(tooth);
        return (
          <button
            key={tooth}
            style={index === 0 && startColumn > 1 ? { gridColumnStart: startColumn } : undefined}
            type="button"
            disabled={selectableTeeth !== undefined && !selectableTeeth.includes(tooth)}
            aria-label={`${tooth}, ${describeIndianTooth(tooth)}${documented.has(tooth) ? ", examination recorded" : ""}`}
            aria-pressed={isSelected}
            title={`Select Indian Standard tooth ${tooth}`}
            onClick={() => onSelect(tooth)}
            onKeyDown={fit ? (event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const buttons = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
              const current = buttons.indexOf(event.currentTarget);
              const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
                : Math.max(0, Math.min(buttons.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
              buttons[next]?.focus();
            } : undefined}
            className={cn(
              "group relative flex min-h-24 min-w-11 flex-col items-center justify-end gap-1 rounded-md border border-transparent px-0.5 py-1 text-slate-600 outline-none transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-25 disabled:pointer-events-none dark:text-slate-300",
              fit && "min-h-[clamp(3rem,10cqw,4.75rem)] min-w-0 gap-0.5 rounded-sm px-0 py-0.5 [&_svg]:h-[clamp(1.5rem,6cqw,3.5rem)] [&_svg]:w-full [&_svg]:max-w-8",
              showMidline && index === quadrantLength && "border-l-border",
              isSelected && "border-primary bg-primary/10 text-primary ring-2 ring-primary/25",
            )}
          >
            {documented.has(tooth) && (
              <span
                aria-hidden="true"
                className={cn("absolute top-1 right-1 size-2 rounded-full bg-emerald-500 ring-2 ring-background", fit && "right-0.5 size-1")}
              />
            )}
            <ToothImage tooth={tooth} arch={arch} />
            <span className={cn("text-xs font-semibold tabular-nums text-foreground", fit && "text-[clamp(0.5rem,2.8cqw,0.75rem)] leading-none")}>{tooth}</span>
          </button>
        );
      })}
    </div>
  );
}
