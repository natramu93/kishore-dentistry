import type { BranchBusinessHour } from "@/lib/database.types";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

function formatClock(value: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function timezoneLabel(timezone: string): string {
  return timezone === "Asia/Kolkata" ? "IST" : timezone;
}

export function formatAppointmentAvailability(
  hours: readonly BranchBusinessHour[],
  timezone: string
): string | null {
  if (hours.length === 0) return null;

  const sorted = [...hours].sort((a, b) => a.iso_weekday - b.iso_weekday);
  const first = sorted[0];
  const isEveryDayAtSameHours =
    sorted.length === 7 &&
    sorted.every(
      (row, index) =>
        row.iso_weekday === index + 1 &&
        row.opens_at === first.opens_at &&
        row.closes_at === first.closes_at
    );
  const zone = timezoneLabel(timezone);

  if (isEveryDayAtSameHours) {
    const close = formatClock(first.closes_at);
    return `Open every day, including Saturday and Sunday, ${formatClock(first.opens_at)}–${close} ${zone}. Choose a time that allows the appointment to finish by ${close}.`;
  }

  const schedule = sorted
    .map(
      (row) =>
        `${WEEKDAYS[row.iso_weekday - 1] ?? `Day ${row.iso_weekday}`} ${formatClock(row.opens_at)}–${formatClock(row.closes_at)}`
    )
    .join("; ");
  return `Appointment hours: ${schedule} ${zone}. Choose a time that finishes before closing.`;
}
