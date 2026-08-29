import { describe, expect, it } from "vitest";
import { formatAppointmentAvailability } from "@/lib/appointment-availability";
import type { BranchBusinessHour } from "@/lib/database.types";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";

function dailyHours(): BranchBusinessHour[] {
  return Array.from({ length: 7 }, (_, index) => ({
    branch_id: BRANCH_ID,
    iso_weekday: index + 1,
    opens_at: "09:00:00",
    closes_at: "19:30:00",
  }));
}

describe("appointment availability copy", () => {
  it("describes the seven-day Tirupur schedule and closing-time rule", () => {
    expect(
      formatAppointmentAvailability(dailyHours(), "Asia/Kolkata")
    ).toBe(
      "Open every day, including Saturday and Sunday, 9:00 AM–7:30 PM IST. Choose a time that allows the appointment to finish by 7:30 PM."
    );
  });

  it("does not claim availability for an unconfigured branch", () => {
    expect(formatAppointmentAvailability([], "Asia/Kolkata")).toBeNull();
  });

  it("lists configured weekdays when the schedule is not uniform", () => {
    expect(
      formatAppointmentAvailability(dailyHours().slice(0, 2), "Asia/Kolkata")
    ).toBe(
      "Appointment hours: Monday 9:00 AM–7:30 PM; Tuesday 9:00 AM–7:30 PM IST. Choose a time that finishes before closing."
    );
  });
});
