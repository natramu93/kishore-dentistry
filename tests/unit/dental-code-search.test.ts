import { describe, expect, it } from "vitest";
import { dentalCodeSearchTerms, matchesDentalCodeSearch } from "@/lib/dental-code-search";

describe("dental diagnosis discovery by procedure terms", () => {
  it.each([['25.92', 'tongue tie'], ['27.41', 'lip tie'], ['27.0', 'abscess drainage'], ['76.96', 'TMJ']])("finds oral procedure %s by %s", (code, query) => {
    expect(matchesDentalCodeSearch(`${code} ${dentalCodeSearchTerms(code)}`, query)).toBe(true);
  });
  it.each([['96.54', 'scaling'], ['23.2', 'GIC filling'], ['23.71', 'rct']])("finds procedure %s by %s", (code, query) => {
    expect(matchesDentalCodeSearch(`${code} ${dentalCodeSearchTerms(code)}`, query)).toBe(true);
  });
  it.each([['96.54', 'scaling'], ['23.2', 'GIC filling'], ['23.71', 'rct']])("finds procedure %s by %s", (code, query) => {
    expect(matchesDentalCodeSearch(`${code} ${dentalCodeSearchTerms(code)}`, query)).toBe(true);
  });
  it.each([['K03.6', 'scaling'], ['K05.1', 'deep cleaning'], ['K02.1', 'filling'], ['K02.9', 'GIC filling'], ['K04.0', 'root canal']])("finds %s when searching %s", (code, query) => {
    expect(matchesDentalCodeSearch(`${code} ${dentalCodeSearchTerms(code)}`, query)).toBe(true);
  });
  it("does not invent codes or associate unrelated conditions", () => {
    expect(dentalCodeSearchTerms('TMT_108')).toBe('');
    expect(dentalCodeSearchTerms('K14.1')).toBe('');
    expect(matchesDentalCodeSearch('K14.1 Geographic tongue', 'filling')).toBe(false);
    expect(matchesDentalCodeSearch('K03.6 Deposits on teeth', 'K03.6')).toBe(true);
  });
  it("matches punctuation and multiple terms without depending on word order", () => {
    expect(matchesDentalCodeSearch('K02.9 Dental caries composite filling', 'filling CARIES')).toBe(true);
    expect(matchesDentalCodeSearch('K02.9 Dental caries', 'K02.9 — Dental caries')).toBe(true);
    expect(matchesDentalCodeSearch('K02.9 Dental caries', 'scaling caries')).toBe(false);
    expect(matchesDentalCodeSearch('K02.9 Dental caries', '')).toBe(true);
  });
});
