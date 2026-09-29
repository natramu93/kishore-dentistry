import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/data/db", () => ({ db: {} }));

import { throwMappedDatabaseError } from "@/data/helpers";

describe("treatment-plan save feedback", () => {
  it.each([
    ["A signed treatment cannot be linked to a different plan", /original treatment-plan link cannot be changed/],
    ["A plan with recorded later care cannot change its code, site or status", /treatment recorded at a later visit/],
    ["Select an earlier pending plan for this patient with the same code and surfaces", /choose the pending work again/],
    ["Complete only teeth from the selected plan", /only the remaining teeth/],
    ["These planned teeth already have a recorded completion. Refresh the patient.", /already been marked treated/],
    ["This planned site is different or already completed", /site has changed or is already treated/],
  ])("makes the known rejection actionable: %s", (message, expected) => {
    expect(() => throwMappedDatabaseError({ code: "23514", message }, "Case sheet")).toThrow(expected);
  });

  it("does not reveal unknown database details", () => {
    expect(() => throwMappedDatabaseError({ code: "23514", message: "internal_relation secret_column" }, "Case sheet"))
      .toThrow("This case sheet could not be saved because the appointment or clinical record changed.");
  });
});
