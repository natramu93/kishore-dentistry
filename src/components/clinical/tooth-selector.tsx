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
  const [dentition, setDentition] = useState<"all" | "permanent" | "primary">("all");
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
      <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap" aria-label="Dentition shown">
        <Button type="button" size="sm" className="h-auto min-h-8 min-w-0 whitespace-normal px-1 py-1 text-[11px] leading-tight" variant={dentition === "all" ? "default" : "outline"} aria-pressed={dentition === "all"} onClick={() => setDentition("all")}>
          Adult &amp; primary teeth
        </Button>
        <Button type="button" size="sm" className="h-auto min-h-8 min-w-0 whitespace-normal px-1 py-1 text-[11px] leading-tight" variant={dentition === "permanent" ? "default" : "outline"} aria-pressed={dentition === "permanent"} onClick={() => setDentition("permanent")}>
          Permanent teeth
        </Button>
        <Button type="button" size="sm" className="h-auto min-h-8 min-w-0 whitespace-normal px-1 py-1 text-[11px] leading-tight" variant={dentition === "primary" ? "default" : "outline"} aria-pressed={dentition === "primary"} onClick={() => setDentition("primary")}>
          Primary (milk) teeth
        </Button>
        {(multiple || onSelectAll) && (
          <Button type="button" size="sm" className="h-auto min-h-8 min-w-0 whitespace-normal px-1 py-1 text-[11px] leading-tight" variant="outline" disabled={disabled || eligibleTeeth.length === 0 || allSelected} onClick={selectAll}>
            Select all
          </Button>
        )}
      </div>
      <div className="min-w-0 rounded-xl border bg-muted/20 p-1.5 sm:p-2">
        <div className="mb-1 flex justify-between gap-2 text-[10px] text-muted-foreground"><span>Patient&apos;s right</span><span>Patient&apos;s left</span></div>
        <div className="min-w-0 space-y-0.5" role="group" aria-label={`${dentition} teeth — Indian Standard dental chart`}>
          {rows.filter((row) => dentition === "all" || row.primary === (dentition === "primary")).map((row) => {
            const eligible: readonly string[] = row.teeth.filter((tooth) => selectableTeeth === undefined || selectableTeeth.includes(tooth));
            const rowSelected = eligible.length > 0 && eligible.every((tooth) => value.includes(tooth));
            return <div key={row.label} role="group" aria-label={row.label}
              className={`grid min-w-0 items-center gap-1 border-b border-border/50 last:border-b-0 ${multiple || onSelectAll ? "grid-cols-[minmax(0,1fr)_1.5rem]" : "grid-cols-1"}`}>
              <ToothChart teeth={row.teeth} selected={value} documentedTeeth={documentedTeeth} selectableTeeth={selectableTeeth}
                arch={row.arch} onSelect={select} columns={16} startColumn={row.primary ? 4 : 1} fit />
                {(multiple || onSelectAll) && <button type="button" disabled={disabled || eligible.length === 0}
                  aria-label={`${rowSelected ? "Deselect" : "Select"} ${row.label.toLowerCase()}`} aria-pressed={rowSelected}
                  title={row.label}
                  className="flex size-6 items-center justify-center rounded border bg-background text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                  onClick={() => {
                    const next = rowSelected ? value.filter((tooth) => !eligible.includes(tooth)) : [...new Set([...value, ...eligible])].sort();
                    (onSelectAll ?? onChange)(next);
                  }}><span aria-hidden="true" className="text-xs">{rowSelected ? "✓" : ""}</span></button>}
            </div>;
          })}
        </div>
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
