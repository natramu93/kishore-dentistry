import { cn } from "@/lib/utils";
import { describeIndianTooth, isPrimaryIndianTooth } from "@/lib/clinical";

type ToothChartProps = {
  teeth: readonly string[];
  selected: string | null;
  arch: "upper" | "lower";
  onSelect: (tooth: string) => void;
  documentedTeeth?: readonly string[];
};

type ToothKind = "incisor" | "canine" | "premolar" | "molar";

const TOOTH_PATHS: Record<ToothKind, string> = {
  incisor:
    "M18 2c-4 0-5 6-5 13l-1 11c-4 3-6 9-5 17 1 8 5 11 11 11s10-3 11-11c1-8-1-14-5-17l-1-11c0-7-1-13-5-13Z",
  canine:
    "M18 1c-4 0-5 7-5 16l-1 10c-4 4-6 10-4 17 2 6 6 10 10 10s8-4 10-10c2-7 0-13-4-17l-1-10c0-9-1-16-5-16Z",
  premolar:
    "M11 3c-3 2-3 9-2 17l2 8c-4 4-5 11-3 17 2 7 5 9 10 9s8-2 10-9c2-6 1-13-3-17l2-8c1-8 1-15-2-17-3-2-5 5-7 11-2-6-4-13-7-11Z",
  molar:
    "M7 3C3 6 5 17 9 27 4 31 3 39 6 47c3 7 7 7 12 4 5 3 9 3 12-4 3-8 2-16-3-20 4-10 6-22 2-28-4-5-8 5-11 14C15 8 11-2 7 3Z",
};

function toothKind(tooth: string): ToothKind {
  const position = Number(tooth[1]);
  if (position <= 2) return "incisor";
  if (position === 3) return "canine";
  if (isPrimaryIndianTooth(tooth)) return "molar";
  if (position <= 5) return "premolar";
  return "molar";
}

function ToothImage({ tooth, arch }: { tooth: string; arch: "upper" | "lower" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 36 56" className="h-12 w-8 overflow-visible drop-shadow-sm">
      <g transform={arch === "lower" ? "rotate(180 18 28)" : undefined}>
        <path
          d={TOOTH_PATHS[toothKind(tooth)]}
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="fill-white dark:fill-slate-950"
        />
        <path
          d="M10 31c5 3 11 3 16 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          opacity=".35"
          vectorEffect="non-scaling-stroke"
        />
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
}: ToothChartProps) {
  const quadrantLength = teeth.length / 2;
  const documented = new Set(documentedTeeth);

  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${teeth.length}, minmax(2.75rem, 1fr))` }}
    >
      {teeth.map((tooth, index) => {
        const isSelected = selected === tooth;
        return (
          <button
            key={tooth}
            type="button"
            aria-label={`${tooth}, ${describeIndianTooth(tooth)}${documented.has(tooth) ? ", examination recorded" : ""}`}
            aria-pressed={isSelected}
            title={`Select Indian Standard tooth ${tooth}`}
            onClick={() => onSelect(tooth)}
            className={cn(
              "group relative flex min-h-20 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg border bg-background px-1 py-1 text-slate-500 outline-none transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-slate-300",
              index === quadrantLength && "ml-2",
              isSelected && "border-primary bg-primary/10 text-primary ring-2 ring-primary/25",
            )}
          >
            {documented.has(tooth) && (
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 size-2 rounded-full bg-emerald-500 ring-2 ring-background"
              />
            )}
            {arch === "lower" && <span className="text-xs font-semibold tabular-nums">{tooth}</span>}
            <ToothImage tooth={tooth} arch={arch} />
            {arch === "upper" && <span className="text-xs font-semibold tabular-nums">{tooth}</span>}
          </button>
        );
      })}
    </div>
  );
}
