import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dentalCodePattern } from "@/lib/validation";
// CMS Version 32 oral/maxillofacial extensions: 25, 26, 27, 76, 87.13 and 87.16.
describe("expanded oral/maxillofacial procedure catalog", () => {
  it("adds all 104 official procedures without duplicates or losing the initial 34", () => {
    const expected = ["25.01","25.02","25.09","25.1","25.2","25.3","25.4","25.51","25.59","25.91","25.92","25.93","25.94","25.99","26.0","26.11","26.12","26.19","26.21","26.29","26.30","26.31","26.32","26.41","26.42","26.49","26.91","26.99","27.0","27.1","27.21","27.22","27.23","27.24","27.29","27.31","27.32","27.41","27.42","27.43","27.49","27.51","27.52","27.53","27.54","27.55","27.56","27.57","27.59","27.61","27.62","27.63","27.64","27.69","27.71","27.72","27.73","27.79","27.91","27.92","27.99","76.01","76.09","76.11","76.19","76.2","76.31","76.39","76.41","76.42","76.43","76.44","76.45","76.46","76.5","76.61","76.62","76.63","76.64","76.65","76.66","76.67","76.68","76.69","76.70","76.71","76.72","76.73","76.74","76.75","76.76","76.77","76.78","76.79","76.91","76.92","76.93","76.94","76.95","76.96","76.97","76.99","87.13","87.16"];
    const sql = readFileSync(resolve('supabase/migrations/20261006035906_expand_icd9_oral_maxillofacial_codes.sql'), 'utf8');
    const seeded = [...sql.matchAll(/\('(\d{2}\.\d{1,2})',/g)].map((match) => match[1]);
    expect(seeded).toEqual(expected);
    expect(seeded).toHaveLength(104);
    expect(new Set(seeded).size).toBe(104);
    const initialSql = readFileSync(resolve('supabase/migrations/20261006035116_add_icd9_dental_procedure_codes.sql'), 'utf8');
    const initial = [...initialSql.matchAll(/\('(\d{2}\.\d{1,2})',/g)].map((match) => match[1]);
    expect(new Set([...initial, ...seeded]).size).toBe(138);
    for (const code of seeded) expect(dentalCodePattern.test(code)).toBe(true);
    expect(sql.match(/'ICD9_CM_PROCEDURE', 'procedure', true/g)).toHaveLength(104);
    expect(sql).toContain('on conflict (code) do nothing');
  });
});
