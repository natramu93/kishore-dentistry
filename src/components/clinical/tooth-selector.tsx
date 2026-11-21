"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToothChart } from "@/components/clinical/tooth-chart";
import { INDIAN_PERMANENT_TEETH, INDIAN_PRIMARY_TEETH } from "@/lib/clinical";

type ToothSelectorProps = {
  value: readonly string[];
  onChange: (teeth: string[]) => void;
  onSelectAll?: (teeth: string[]) => void;
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
  onSelectAll,
  documentedTeeth = [],
  selectableTeeth,
  label = "Select teeth",
  multiple = true,
  disabled = false,
}: ToothSelectorProps) {
  const id = useId();
  const [dentition, setDentition] = useState<"all" | "permanent" | "primary">(
    value.length > 0 && value.every((tooth) => Number(tooth[0]) >= 5) ? "primary" : "all",
  );
  const teeth = dentition === "all" ? [...INDIAN_PERMANENT_TEETH, ...INDIAN_PRIMARY_TEETH] : dentition === "permanent" ? INDIAN_PERMANENT_TEETH : INDIAN_PRIMARY_TEETH;
  const eligibleTeeth = teeth.filter((tooth) => selectableTeeth === undefined || selectableTeeth.includes(tooth));
  const allSelected = eligibleTeeth.length > 0 && eligibleTeeth.every((tooth) => value.includes(tooth));
  const rows = [
    { label: "Upper primary teeth", arch: "upper" as const, primary: true, teeth: INDIAN_PRIMARY_TEETH.slice(0, 10) },
    { label: "Upper permanent teeth", arch: "upper" as const, primary: false, teeth: INDIAN_PERMANENT_TEETH.slice(0, 16) },
    { label: "Lower permanent teeth", arch: "lower" as const, primary: false, teeth: INDIAN_PERMANENT_TEETH.slice(16) },
    { label: "Lower primary teeth", arch: "lower" as const, primary: true, teeth: INDIAN_PRIMARY_TEETH.slice(10) },
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

  function selectAll() {
    if (disabled || eligibleTeeth.length === 0) return;
    const selection = [...new Set([...value, ...eligibleTeeth])].sort();
    (onSelectAll ?? onChange)(selection);
  }

  return (
    <fieldset disabled={disabled} aria-describedby={`${id}-selection`} className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2" aria-label="Dentition shown">
        <Button type="button" size="sm" variant={dentition === "all" ? "default" : "outline"} aria-pressed={dentition === "all"} onClick={() => setDentition("all")}>
          Adult &amp; primary teeth
        </Button>
        <Button type="button" size="sm" variant={dentition === "permanent" ? "default" : "outline"} aria-pressed={dentition === "permanent"} onClick={() => setDentition("permanent")}>
          Permanent teeth
        </Button>
        <Button type="button" size="sm" variant={dentition === "primary" ? "default" : "outline"} aria-pressed={dentition === "primary"} onClick={() => setDentition("primary")}>
          Primary (milk) teeth
        </Button>
        {(multiple || onSelectAll) && (
          <Button type="button" size="sm" variant="outline" disabled={disabled || eligibleTeeth.length === 0 || allSelected} onClick={selectAll}>
            Select all
          </Button>
        )}
      </div>
      <div className="@container/matrix min-w-0 rounded-xl border bg-muted/20 p-2 sm:p-3">
        <p className="mb-2 text-xs text-muted-foreground">Right and left refer to the patient. Quadrants wrap to fit your screen.</p>
        <div className="min-w-0 space-y-2" role="group" aria-label={`${dentition} teeth — Indian Standard dental chart`}>
          {rows.filter((row) => dentition === "all" || row.primary === (dentition === "primary")).map((row) => {
            const eligible: readonly string[] = row.teeth.filter((tooth) => selectableTeeth === undefined || selectableTeeth.includes(tooth));
            const rowSelected = eligible.length > 0 && eligible.every((tooth) => value.includes(tooth));
            return <div key={row.label} role="group" aria-label={row.label} className="space-y-0.5 border-b border-border/50 pb-1 last:border-b-0">
              <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-muted-foreground">{row.label}</p>
                {(multiple || onSelectAll) && <button type="button" disabled={disabled || eligible.length === 0}
                  aria-label={`${rowSelected ? "Deselect" : "Select"} ${row.label.toLowerCase()}`} aria-pressed={rowSelected}
                  className="flex size-11 items-center justify-center rounded-md border bg-background text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                  onClick={() => {
                    const next = rowSelected ? value.filter((tooth) => !eligible.includes(tooth)) : [...new Set([...value, ...eligible])].sort();
                    (onSelectAll ?? onChange)(next);
                  }}><span aria-hidden="true" className="flex size-5 items-center justify-center rounded border border-current text-sm">{rowSelected ? "✓" : ""}</span></button>}
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-2 @min-[32rem]/matrix:grid-cols-2">
                {[row.teeth.slice(0, row.teeth.length / 2), row.teeth.slice(row.teeth.length / 2)].map((quadrant, index) => <div key={index} className="min-w-0">
                  <p className="mb-1 text-xs text-muted-foreground">Patient&apos;s {index === 0 ? "right" : "left"}</p>
                  <ToothChart teeth={quadrant} selected={value} documentedTeeth={documentedTeeth} selectableTeeth={selectableTeeth}
                    arch={row.arch} onSelect={select} columns={8} startColumn={row.primary && index === 0 ? 4 : 1}
                    compactColumns={row.primary ? 5 : 4} fit showMidline={false} />
                </div>)}
              </div>
            </div>;
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{multiple || onSelectAll ? "Select all applies to the displayed eligible teeth. Tap individual teeth to adjust the selection." : "Tap a tooth to review or update its record."}</p>
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
