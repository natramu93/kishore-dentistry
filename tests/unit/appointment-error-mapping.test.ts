import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { throwMappedDatabaseError } from "@/data/helpers";
import { ConflictError, ValidationError } from "@/lib/errors";

describe("appointment availability database errors", () => {
  it.each([
    "Appointments are available every day, including Saturday and Sunday, from 9:00 AM to 7:30 PM IST and must finish by 7:30 PM",
    "The clinic is closed on the selected day",
  ])("returns the safe availability message to booking forms", (message) => {
    expect(() =>
      throwMappedDatabaseError({ code: "23514", message }, "Appointment")
    ).toThrow(new ValidationError(message));
  });

  it("keeps unrelated database constraint details private", () => {
    expect(() =>
      throwMappedDatabaseError(
        { code: "23514", message: "internal constraint detail" },
        "Appointment"
      )
    ).toThrow(
      new ConflictError("Appointment cannot be changed in its current state")
    );
  });
});
