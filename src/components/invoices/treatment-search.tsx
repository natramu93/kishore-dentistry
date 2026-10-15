"use client";

import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronsUpDown, X } from "lucide-react";

export type TreatmentSearchOption = { value: string; label: string; searchText?: string };

function matchesTreatment(option: TreatmentSearchOption, query: string) {
  const text = (option.searchText ?? option.label).toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every((word) => text.includes(word));
}

/** A searchable catalog selection, never a free-text invoice charge. */
export function TreatmentSearch({ id, value, options, onChange, required = false, disabled = false, placeholder = "Search treatments…" }: {
  id: string;
  value: string;
  options: TreatmentSearchOption[];
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  return <Combobox.Root
    items={options}
    value={options.find((option) => option.value === value) ?? null}
    onValueChange={(option) => onChange(option?.value ?? "")}
    isItemEqualToValue={(option, selected) => option.value === selected.value}
    filter={matchesTreatment}
    autoHighlight
    required={required}
    disabled={disabled}
  >
    <Combobox.InputGroup className="flex h-11 w-full min-w-0 rounded-lg border border-input bg-transparent focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      <Combobox.Input id={id} placeholder={placeholder} autoComplete="off" required={required}
        aria-describedby={`${id}-help`}
        className="h-full w-full min-w-0 flex-1 rounded-lg bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground disabled:opacity-50 md:text-sm" />
      <Combobox.Clear aria-label="Clear treatment" className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <X aria-hidden="true" className="size-4" />
      </Combobox.Clear>
      <Combobox.Trigger aria-label="Show treatments" className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50">
        <ChevronsUpDown aria-hidden="true" className="size-4" />
      </Combobox.Trigger>
    </Combobox.InputGroup>
    <span id={`${id}-help`} className="sr-only">Type to search treatments, then choose a result. Use the arrow keys and Enter to select.</span>
    <Combobox.Portal>
      <Combobox.Positioner sideOffset={4} align="start" className="isolate z-50 w-(--anchor-width) max-w-[calc(100vw-1rem)]">
        <Combobox.Popup className="w-full rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          <Combobox.Empty className="p-3 text-sm text-muted-foreground">No matching treatments. Try another name or category.</Combobox.Empty>
          <Combobox.List className="max-h-64 overflow-y-auto overscroll-contain">
            {(option: TreatmentSearchOption) => <Combobox.Item key={option.value} value={option}
              className="relative flex min-h-11 cursor-pointer items-center gap-2 rounded-md py-2 pr-3 pl-9 text-sm break-words outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground">
              <Combobox.ItemIndicator className="absolute left-3"><Check aria-hidden="true" className="size-4" /></Combobox.ItemIndicator>
              {option.label}
            </Combobox.Item>}
          </Combobox.List>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  </Combobox.Root>;
}
