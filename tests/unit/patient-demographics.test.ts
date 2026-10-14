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
    expect(patientDisplayName({ title: "Mrs", name: "SuwETHA RAJAN" })).toBe("Mrs. Suwetha Rajan");
    expect(patientDisplayName({ name: "RAVI" })).toBe("Ravi");
  });
  it.each([["Mr","Mr."],["Ms","Ms."],["Mrs","Mrs."],["Baby","Baby"],["Master","Master"]])("formats saved title %s", (title,label) => {
    expect(patientDisplayName({ title,name:"TEST PATIENT" })).toBe(`${label} Test Patient`);
  });
  it("does not duplicate legacy titles or guess missing titles", () => {
    expect(patientDisplayName({ title:"Mr",name:"MR. TEST PATIENT" })).toBe("Mr. Test Patient");
    expect(patientDisplayName({ title:"Ms",name:"Mrs. Test Patient" })).toBe("Ms. Test Patient");
    expect(patientDisplayName({ name:"MRS TEST PATIENT" })).toBe("Mrs. Test Patient");
    expect(patientDisplayName({ title:"Mr",name:"Mr.TEST PATIENT" })).toBe("Mr. Test Patient");
    expect(patientDisplayName({ name:"Test Patient",title:null })).toBe("Test Patient");
  });
});
