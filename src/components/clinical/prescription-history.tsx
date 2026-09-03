import type { PrescriptionItem } from "@/lib/database.types";

const FOOD_LABELS: Record<PrescriptionItem["food_timing"], string> = {
  before_food: "Before food",
  after_food: "After food",
  with_food: "With food",
  not_applicable: "Food timing not specified",
};

function schedule(item: PrescriptionItem): string {
  return [
    item.morning ? "Morning" : null,
    item.noon ? "Noon / lunch" : null,
    item.night ? "Night" : null,
  ].filter(Boolean).join(" · ");
}

export function PrescriptionHistory({ items }: { items: PrescriptionItem[] }) {
  if (items.length === 0) return null;
  return (
    <details className="rounded-md border bg-muted/20 p-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
        Prescription ({items.length} {items.length === 1 ? "medicine" : "medicines"})
      </summary>
      <ol className="mt-2 space-y-3">
        {[...items]
          .sort((left, right) => left.line_number - right.line_number)
          .map((item) => (
            <li key={item.id} className="rounded-md border bg-background p-3 text-sm">
              <p className="font-medium">
                {item.line_number}. {item.medicine_name}
                {item.strength ? ` · ${item.strength}` : ""}
              </p>
              <p className="mt-1 text-muted-foreground">
                {item.dosage ? `${item.dosage} · ` : ""}{schedule(item)} · {FOOD_LABELS[item.food_timing]}
                {item.duration_days ? ` · ${item.duration_days} days` : ""}
              </p>
              {item.instructions && (
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{item.instructions}</p>
              )}
            </li>
          ))}
      </ol>
    </details>
  );
}
