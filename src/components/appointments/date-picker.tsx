"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

function localDateFromValue(value: string | undefined) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const date = new Date(year, month - 1, day, 12);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }
  return date;
}

export function AppointmentDatePicker({
  selectedDate,
  filters,
}: {
  selectedDate?: string;
  filters: { branch?: string; doctor?: string; status?: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const selected = localDateFromValue(selectedDate);

  function chooseDate(date: Date | undefined) {
    if (!date) return;
    const params = new URLSearchParams();
    params.set("view", "date");
    params.set("date", format(date, "yyyy-MM-dd"));
    if (filters.branch) params.set("branch", filters.branch);
    if (filters.doctor) params.set("doctor", filters.doctor);
    if (filters.status) params.set("status", filters.status);
    setOpen(false);
    router.push(`/appointments?${params.toString()}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant={selectedDate ? "default" : "outline"}
            aria-pressed={Boolean(selectedDate)}
            aria-label={
              selected
                ? `Choose appointment date. Selected ${format(selected, "d MMMM yyyy")}`
                : "Choose appointment date"
            }
          >
            <CalendarDays aria-hidden="true" />
            {selected ? format(selected, "d MMM") : "Choose date"}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-1rem)] overflow-auto p-0">
        <PopoverHeader className="sr-only">
          <PopoverTitle>Choose appointment date</PopoverTitle>
        </PopoverHeader>
        <Calendar
          mode="single"
          required
          selected={selected}
          defaultMonth={selected}
          onSelect={chooseDate}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
