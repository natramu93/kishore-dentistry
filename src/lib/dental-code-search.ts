/** Synonyms aid discovery only; they never assign a code automatically.
 * Official labels remain unchanged. Clinicians explicitly choose an ICD-10
 * diagnosis or an ICD-9-CM procedure, and record additional details in notes.
 * Diagnosis scope: WHO ICD-10 2019 K00–K14, https://icd.who.int/browse10/2019/en#/K00-K14
 * Procedure scope: CMS Version 32 dental/oral/maxillofacial ICD-9-CM Volume 3 codes.
 */
export function dentalCodeSearchTerms(code: string): string {
  if (code === "96.54") return "scaling scale cleaning polishing tartar calculus plaque deposits";
  if (code === "23.2") return "filling fillings restoration restorative composite gic glass ionomer cavity cavities";
  if (/^23[.]7[0-3]$/.test(code)) return "root canal rct endodontic";
  if (["25.91", "25.92"].includes(code)) return "tongue tie release lingual frenum";
  if (["27.41", "27.91"].includes(code)) return "lip tie release labial frenum";
  if (code === "27.0") return "oral abscess drainage floor mouth";
  if (["76.5", "76.93", "76.94", "76.95", "76.96", "87.13"].includes(code)) return "tmj jaw joint temporomandibular";
  if (code === "K03.6") return "scaling scale cleaning polishing tartar calculus plaque deposits";
  if (/^K05(?:\.[0-6])?$/.test(code)) return "scaling cleaning deep cleaning root planing periodontal gum disease gum treatment";
  if (/^K02(?:\.[0-589])?$/.test(code)) return "filling fillings restoration restorative composite gic glass ionomer cavity cavities tooth decay";
  if (["K03.0", "K03.1", "K03.2"].includes(code)) return "filling restoration tooth wear";
  if (/^K04(?:\.[0-9])?$/.test(code)) return "root canal rct endodontic";
  if (/^K01(?:\.[01])?$/.test(code)) return "impacted wisdom tooth extraction";
  if (code === "K08.1") return "missing teeth tooth loss denture implant";
  return "";
}

export function normalizeDentalCodeSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
}

export function matchesDentalCodeSearch(searchText: string, query: string): boolean {
  const text = normalizeDentalCodeSearch(searchText);
  return normalizeDentalCodeSearch(query).split(/\s+/).filter(Boolean).every((term) => text.includes(term));
}
