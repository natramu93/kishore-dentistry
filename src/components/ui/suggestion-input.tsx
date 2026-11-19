"use client";

import { useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SuggestionOption = { value: string; label: string; key?: string; searchText?: string };
type SuggestionInputProps = Omit<ComponentProps<typeof Input>, "id" | "value" | "defaultValue" | "onChange" | "onKeyDown"> & {
  id: string; value: string; options: readonly SuggestionOption[];
  onValueChange: (value: string) => void; onOptionSelect?: (option: SuggestionOption) => void;
};

/** Free-text input with explicit, keyboard-accessible suggestions. Never submits a form on Enter. */
export function SuggestionInput({ id, value, options, onValueChange, onOptionSelect, className, onFocus, onBlur, ...props }: SuggestionInputProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const expanded = open && !props.disabled && !props.readOnly;
  const words = value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = options.filter((option) => words.every((word) => (option.searchText ?? option.label).toLocaleLowerCase().includes(word))).slice(0, 20);
  const activeIndex = matches.length ? Math.min(active, matches.length - 1) : -1;
  function choose(option: SuggestionOption) {
    if (props.disabled || props.readOnly) return;
    onValueChange(option.value);
    onOptionSelect?.(option);
    setOpen(false);
    setActive(0);
  }
  return <div className="relative min-w-0">
    <Input {...props} id={id} value={value} role="combobox" aria-autocomplete="list" autoComplete="off"
      aria-expanded={expanded} aria-controls={expanded ? `${id}-options` : undefined}
      aria-activedescendant={expanded && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
      className={className}
      onChange={(event) => { onValueChange(event.target.value); setOpen(true); setActive(0); }}
      onFocus={(event) => { setOpen(true); setActive(0); onFocus?.(event); }}
      onBlur={(event) => { setOpen(false); onBlur?.(event); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
          setActive(!open ? event.key === "ArrowDown" ? 0 : Math.max(0, matches.length - 1)
            : matches.length ? (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length : 0);
        } else if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          if (open && activeIndex >= 0) choose(matches[activeIndex]);
        } else if (event.key === "Escape") {
          if (open) { event.preventDefault(); event.stopPropagation(); }
          setOpen(false);
        } else if (event.key === "Tab") setOpen(false);
      }} />
    {expanded && <div id={`${id}-options`} role="listbox" aria-label="Suggestions"
      className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
      {matches.map((option, index) => <button key={option.key ?? option.value} id={`${id}-option-${index}`} type="button"
        role="option" aria-selected={index === activeIndex} tabIndex={-1}
        ref={(node) => { if (index === activeIndex) node?.scrollIntoView?.({ block: "nearest" }); }}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}
        className={cn("flex min-h-11 w-full items-center rounded-md px-3 py-2 text-left text-sm whitespace-normal break-words hover:bg-accent", index === activeIndex && "bg-accent text-accent-foreground")}>
        {option.label}
      </button>)}
      {!matches.length && <p className="px-3 py-2 text-sm text-muted-foreground">No saved suggestions. You can keep the value you typed.</p>}
    </div>}
  </div>;
}

/** For server-rendered forms that submit their field values through FormData. */
export function SuggestionField({ defaultValue = "", ...props }: Omit<SuggestionInputProps, "value" | "onValueChange" | "onOptionSelect"> & { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  return <SuggestionInput {...props} value={value} onValueChange={setValue} />;
}
