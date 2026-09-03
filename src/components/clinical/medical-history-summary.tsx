import { Badge } from "@/components/ui/badge";
import {
  MEDICAL_HISTORY_CONDITIONS,
  type MedicalHistoryCondition,
  type MedicalHistoryReviewStatus,
} from "@/lib/medical-history";

const CONDITION_LABELS = new Map<MedicalHistoryCondition, string>(
  MEDICAL_HISTORY_CONDITIONS.map((condition) => [condition.value, condition.label]),
);

export function MedicalHistorySummary({
  reviewStatus,
  conditions,
  description,
  compact = false,
}: {
  reviewStatus: MedicalHistoryReviewStatus;
  conditions: MedicalHistoryCondition[];
  description: string | null;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "space-y-2" : "space-y-3 rounded-lg border bg-muted/20 p-3"}>
      {reviewStatus === "not_reviewed" && (
        <p className="text-sm text-muted-foreground">Medical history has not yet been reviewed.</p>
      )}
      {reviewStatus === "reviewed_none" && (
        <Badge variant="secondary">No known medical conditions</Badge>
      )}
      {conditions.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Recorded medical conditions">
          {conditions.map((condition) => (
            <Badge key={condition} variant="outline">
              {CONDITION_LABELS.get(condition) ?? condition.replaceAll("_", " ")}
            </Badge>
          ))}
        </div>
      )}
      {description && (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
