import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Presentation only: the database verifies the amendment window again when saving. */
export function CaseSheetEditLink({
  caseSheetId,
  finalizedAt,
  canEdit,
  now,
}: {
  caseSheetId: string;
  finalizedAt: string;
  canEdit: boolean;
  now: number;
}) {
  if (!canEdit) return null;
  const finalizedTime = Date.parse(finalizedAt);
  const withinWindow = Number.isFinite(finalizedTime) && now <= finalizedTime + 24 * 60 * 60 * 1_000;

  if (!withinWindow) {
    return <span className="text-xs text-muted-foreground">Read-only · 24-hour edit window ended</span>;
  }

  return (
    <Button asChild size="sm" variant="outline">
      <Link href={`/case-sheets/${caseSheetId}/edit`}>Edit case sheet</Link>
    </Button>
  );
}
