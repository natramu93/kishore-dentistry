import { clinicDayRange, clinicToday } from "@/lib/tz";
import { assertDateOnly } from "@/lib/validation";

/** Omitted filter dates always mean today in the clinic's timezone. */
export function clinicDateFilterDefaults(params: { from?: string; to?: string; dates?: string }, today = clinicToday()) {
  const allDates = params.dates === "all" || (params.from === "" && params.to === "");
  const validOrDefault = (value: string | undefined) => {
    if (value === "" || allDates) return "";
    try { return value ? assertDateOnly(value) : today; } catch { return today; }
  };
  const fromValue = validOrDefault(params.from);
  const toValue = validOrDefault(params.to);
  return {
    fromValue, toValue,
    from: fromValue ? clinicDayRange(fromValue).start : undefined,
    to: toValue ? clinicDayRange(toValue).end : undefined,
  };
}
