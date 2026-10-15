"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { joinClinicClock, splitClinicClock, type ClinicClockParts } from "@/lib/clinic-clock";

const selectClass = "h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm";

/** Explicit AM/PM controls do not depend on the device's native clock preference. */
export function ClinicDateTimeInput({ id, name, label, defaultValue = "", required = false, disabled = false }: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [parts, setParts] = useState(() => splitClinicClock(defaultValue));
  const change = (patch: Partial<ClinicClockParts>) => setParts((previous) => ({ ...previous, ...patch }));
  let value = "";
  try { value = joinClinicClock(parts); } catch { /* Native controls flag incomplete/invalid dates. */ }
  return <fieldset disabled={disabled} className="space-y-2" aria-describedby={`${id}-help`}>
    <legend className="text-sm font-medium">{label}</legend>
    <input type="hidden" name={name} value={value} disabled={disabled} />
    <div className="grid gap-3">
      <div className="space-y-1.5">
        <Label htmlFor={id}>Date</Label>
        <Input id={id} type="date" value={parts.date} required={required}
          onChange={(event) => change({ date: event.target.value })} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-hour`}>Hour</Label>
          <select id={`${id}-hour`} className={selectClass} value={parts.hour} required={required}
            onChange={(event) => change({ hour: event.target.value })}>
            <option value="">—</option>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => <option key={hour} value={hour}>{hour}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-minute`}>Minute</Label>
          <select id={`${id}-minute`} className={selectClass} value={parts.minute} required={required}
            onChange={(event) => change({ minute: event.target.value })}>
            {Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, "0")).map((minute) => <option key={minute} value={minute}>{minute}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-period`}>AM / PM</Label>
          <select id={`${id}-period`} className={selectClass} value={parts.period} required={required}
            onChange={(event) => change({ period: event.target.value as ClinicClockParts["period"] })}>
            <option value="">—</option><option value="AM">AM</option><option value="PM">PM</option>
          </select>
        </div>
      </div>
    </div>
    <p id={`${id}-help`} className="text-xs text-muted-foreground">Choose any time, including outside clinic hours. 12-hour clock · Indian Standard Time (IST). 12 AM is midnight; 12 PM is noon.</p>
  </fieldset>;
}
