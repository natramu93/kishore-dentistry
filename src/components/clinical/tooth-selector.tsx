"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToothChart } from "@/components/clinical/tooth-chart";
import { INDIAN_PERMANENT_TEETH, INDIAN_PRIMARY_TEETH } from "@/lib/clinical";

type ToothSelectorProps = {
  value: readonly string[];
  onChange: (teeth: string[]) => void;
  documentedTeeth?: readonly string[];
  selectableTeeth?: readonly string[];
  label?: string;
  multiple?: boolean;
  disabled?: boolean;
};

/** Shared selection only: choosing teeth never creates or replaces clinical records. */
export function ToothSelector({
  value,
  onChange,
  documentedTeeth = [],
  selectableTeeth,
  label = "Select teeth",
  multiple = true,
  disabled = false,
}: ToothSelectorProps) {
  const id = useId();
  const [dentition, setDentition] = useState<"permanent" | "primary">(
    value.length > 0 && value.every((tooth) => Number(tooth[0]) >= 5) ? "primary" : "permanent",
  );
  const teeth = dentition === "permanent" ? INDIAN_PERMANENT_TEETH : INDIAN_PRIMARY_TEETH;
  const quarter = teeth.length / 4;
  const quadrants = [
    { label: "Upper right", arch: "upper" as const, teeth: teeth.slice(0, quarter) },
    { label: "Upper left", arch: "upper" as const, teeth: teeth.slice(quarter, quarter * 2) },
    { label: "Lower right", arch: "lower" as const, teeth: teeth.slice(quarter * 2, quarter * 3) },
    { label: "Lower left", arch: "lower" as const, teeth: teeth.slice(quarter * 3) },
  ];

  function select(tooth: string) {
    if (disabled || (selectableTeeth !== undefined && !selectableTeeth.includes(tooth))) return;
    if (!multiple) {
      onChange([tooth]);
      return;
    }
    onChange(value.includes(tooth)
      ? value.filter((item) => item !== tooth)
      : [...value, tooth].sort());
  }

  return (
    <fieldset disabled={disabled} aria-describedby={`${id}-selection`} className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2" aria-label="Dentition shown">
        <Button type="button" size="sm" variant={dentition === "permanent" ? "default" : "outline"} aria-pressed={dentition === "permanent"} onClick={() => setDentition("permanent")}>
          Permanent teeth
        </Button>
        <Button type="button" size="sm" variant={dentition === "primary" ? "default" : "outline"} aria-pressed={dentition === "primary"} onClick={() => setDentition("primary")}>
          Primary (milk) teeth
        </Button>
      </div>
      <div className="min-w-0 rounded-xl border bg-muted/20 p-2 sm:p-3">
        <p className="mb-3 text-xs text-muted-foreground">Right and left refer to the patient&apos;s side.</p>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2" role="group" aria-label={`${dentition} teeth — Indian Standard dental chart`}>
          {quadrants.map((quadrant) => (
            <div key={quadrant.label} role="group" aria-label={quadrant.label} className="min-w-0 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{quadrant.label}</p>
              <ToothChart teeth={quadrant.teeth} selected={value} documentedTeeth={documentedTeeth} selectableTeeth={selectableTeeth} arch={quadrant.arch} onSelect={select} columns={4} showMidline={false} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{multiple ? "Tap all relevant teeth. Tap again to deselect." : "Tap a tooth to review or update its record."}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-selection`} role="status" className="text-sm">
          {value.length === 0 ? "No teeth selected" : `Selected ${value.length === 1 ? "tooth" : "teeth"}: ${[...value].sort().join(", ")}`}
        </p>
        {value.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>Clear selection</Button>}
      </div>
    </fieldset>
  );
}
