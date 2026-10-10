import { describe, expect, it } from "vitest";
import { genderForTitle, patientNameTitleCase, patientDisplayName } from "@/lib/patient-demographics";

describe("patient identity", () => {
  it.each([["Mr", "male"], ["Master", "male"], ["Ms", "female"], ["Mrs", "female"], ["Baby", null], [null, null]])("suggests gender for %s without guessing for Baby", (title, expected) => {
    expect(genderForTitle(title)).toBe(expected);
  });
  it("normalizes every whitespace-separated word, not punctuation-separated parts", () => {
    expect(patientNameTitleCase("  sUWETHA   RAJAN\tO'NEILL ANNA-MARIA ")).toBe("Suwetha Rajan O'neill Anna-maria");
    expect(patientNameTitleCase("ÉLODIE KUMAR")).toBe("Élodie Kumar");
    expect(patientNameTitleCase("   ")).toBe("");
  });
  it("keeps the title separate from the stored name but shows both", () => {
    expect(patientDisplayName({ title: "Mrs", name: "SuwETHA RAJAN" })).toBe("Mrs Suwetha Rajan");
    expect(patientDisplayName({ name: "RAVI" })).toBe("Ravi");
  });
});
