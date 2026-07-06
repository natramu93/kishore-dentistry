import type { TreatmentType } from "@/lib/database.types";

// Display order for treatment categories (roughly patient journey / complexity).
export const CATEGORY_ORDER = [
  "Consultation & Diagnostics",
  "Preventive",
  "Restorative",
  "Endodontics",
  "Crowns & Bridges",
  "Dentures",
  "Dental Implants",
  "Orthodontics",
  "Oral Surgery",
  "Periodontics",
  "Cosmetic Dentistry",
  "Pediatric Dentistry",
];

export function categoryRank(category: string | null): number {
  const i = CATEGORY_ORDER.indexOf(category ?? "");
  return i === -1 ? CATEGORY_ORDER.length : i;
}

/** Group treatment types by category in the canonical display order. */
export function groupByCategory(
  types: TreatmentType[]
): { category: string; items: TreatmentType[] }[] {
  const map = new Map<string, TreatmentType[]>();
  for (const t of types) {
    const key = t.category ?? "Other";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return [...map.entries()]
    .sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]))
    .map(([category, items]) => ({
      category,
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}
