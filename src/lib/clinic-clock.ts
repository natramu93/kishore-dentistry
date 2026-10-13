import { clinicTimeToUtc } from "@/lib/tz";
import { ValidationError } from "@/lib/errors";

export type ClinicClockParts = {
  date: string;
  hour: string;
  minute: string;
  period: "AM" | "PM" | "";
};

/** Canonical clinic wall times stay 24-hour values internally, never visible clocks. */
export function splitClinicClock(value: string): ClinicClockParts {
  if (!value) return { date: "", hour: "", minute: "00", period: "" };
  clinicTimeToUtc(value); // Validate the calendar date and wall-clock bounds.
  const [date, time] = value.split("T");
  const [hour, minute] = time.split(":");
  const hour24 = Number(hour);
  return { date, hour: String(hour24 % 12 || 12), minute, period: hour24 >= 12 ? "PM" : "AM" };
}

export function joinClinicClock(parts: ClinicClockParts): string {
  if (!parts.date || !parts.hour || !parts.minute || !parts.period) return "";
  if (!/^(?:[1-9]|1[0-2])$/.test(parts.hour) || !/^[0-5][0-9]$/.test(parts.minute)
      || (parts.period !== "AM" && parts.period !== "PM")) {
    throw new ValidationError("Date and time is invalid");
  }
  const hour24 = Number(parts.hour) % 12 + (parts.period === "PM" ? 12 : 0);
  const value = `${parts.date}T${String(hour24).padStart(2, "0")}:${parts.minute}`;
  clinicTimeToUtc(value);
  return value;
}
