import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

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
  return fromZonedTime(local, CLINIC_TZ).toISOString();
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
  const start = fromZonedTime(`${dateStr}T00:00:00`, CLINIC_TZ);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}
