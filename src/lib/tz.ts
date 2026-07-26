import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";
import { ValidationError } from "@/lib/errors";
import { assertDateOnly } from "@/lib/validation";

export const CLINIC_TZ = "Asia/Kolkata";

/** Format a stored timestamptz for display, pinned to clinic timezone. */
export function fmt(ts: string | Date, pattern = "d MMM yyyy, h:mm a"): string {
  return formatInTimeZone(ts, CLINIC_TZ, pattern);
}

export function fmtDate(ts: string | Date): string {
  return formatInTimeZone(ts, CLINIC_TZ, "d MMM yyyy");
}

export function fmtTime(ts: string | Date): string {
  return formatInTimeZone(ts, CLINIC_TZ, "h:mm a");
}

/** Convert a datetime-local input value (clinic wall time) to a UTC ISO string. */
export function clinicTimeToUtc(local: string): string {
  const match =
    typeof local === "string"
      ? local.match(
          /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
        )
      : null;
  if (!match) {
    throw new ValidationError("Date and time is invalid");
  }
  const [, date, hourText, minuteText, secondText] = match;
  assertDateOnly(date, "Date and time");
  if (
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText ?? "0") > 59
  ) {
    throw new ValidationError("Date and time is invalid");
  }
  const converted = fromZonedTime(local, CLINIC_TZ);
  if (!Number.isFinite(converted.getTime())) {
    throw new ValidationError("Date and time is invalid");
  }
  return converted.toISOString();
}

/** Format a stored timestamptz as a datetime-local input value in clinic tz. */
export function toClinicInputValue(ts: string | Date): string {
  return formatInTimeZone(ts, CLINIC_TZ, "yyyy-MM-dd'T'HH:mm");
}

/** Today's date (yyyy-MM-dd) in clinic timezone. */
export function clinicToday(): string {
  return formatInTimeZone(new Date(), CLINIC_TZ, "yyyy-MM-dd");
}

/** Clinic-day boundaries as UTC ISO strings, for range queries. */
export function clinicDayRange(dateStr: string): { start: string; end: string } {
  const date = assertDateOnly(dateStr);
  const start = fromZonedTime(`${date}T00:00:00`, CLINIC_TZ);
  const nextDate = formatInTimeZone(addDays(start, 1), CLINIC_TZ, "yyyy-MM-dd");
  const end = fromZonedTime(`${nextDate}T00:00:00`, CLINIC_TZ);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}
