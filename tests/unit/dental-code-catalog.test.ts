import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dentalCodePattern } from "@/lib/validation";

// Independently verified against the WHO 2019 browser on 6 October 2026.
// https://icd.who.int/browse10/2019/en#/K00-K14
// This is the complete oral-health block, not every ICD-10 chapter.
const WHO_ORAL_SUBCATEGORIES: Record<string, string> = {
  K00: "0123456789", K01: "01", K02: "01234589", K03: "0123456789",
  K04: "0123456789", K05: "0123456", K06: "01289", K07: "012345689",
  K08: "012389", K09: "01289", K10: "012389", K11: "0123456789",
  K12: "0123", K13: "01234567", K14: "012345689",
};

describe("WHO ICD-10 2019 oral-health catalog completeness", () => {
  it("seeds every K00–K14 category and subcategory without invented codes", () => {
    const expected = Object.entries(WHO_ORAL_SUBCATEGORIES).flatMap(([category, suffixes]) => [
      category, ...[...suffixes].map((suffix) => `${category}.${suffix}`),
    ]).sort();
    const sql = readFileSync(resolve("supabase/migrations/20260913102746_managed_icd10_dental_codes.sql"), "utf8");
    const seeded = [...sql.matchAll(/\('(K\d{2}(?:\.[0-9A-Z]+)?)',/g)].map((match) => match[1]).sort();
    expect(expected).toHaveLength(124);
    expect(seeded).toEqual(expected);
    expect(new Set(seeded).size).toBe(124);
  });
});

describe("CMS Version 32 dental procedure catalog", () => {
  it("seeds all 34 dental procedures with a separate code system", () => {
    const expected = [
      '23.01', '23.09', '23.11', '23.19', '23.2', '23.3', '23.41', '23.42',
      '23.43', '23.49', '23.5', '23.6', '23.70', '23.71', '23.72', '23.73',
      '24.0', '24.11', '24.12', '24.19', '24.2', '24.31', '24.32', '24.39',
      '24.4', '24.5', '24.6', '24.7', '24.8', '24.91', '24.99', '87.11', '87.12', '96.54',
    ];
    const sql = readFileSync(resolve('supabase/migrations/20261006035116_add_icd9_dental_procedure_codes.sql'), 'utf8');
    const seeded = [...sql.matchAll(/\('(\d{2}\.\d{1,2})',/g)].map((match) => match[1]);
    expect(seeded).toEqual(expected);
    expect(new Set(seeded).size).toBe(34);
    for (const code of seeded) expect(dentalCodePattern.test(code)).toBe(true);
    expect(sql.match(/'ICD9_CM_PROCEDURE', 'procedure', true/g)).toHaveLength(34);
    expect(sql).toContain('on conflict (code) do nothing');
  });
});
