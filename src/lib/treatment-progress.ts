import type { Treatment } from "@/lib/database.types";
import type { ClinicalAttachmentView } from "@/lib/clinical-files";
import type { CommentWithAuthor } from "@/data/comments";

export type TreatmentDetails = {
  treatment: TreatmentProgressRecord;
  attachments: ClinicalAttachmentView[];
  filesAvailable: boolean;
  canUpload: boolean;
  comments: CommentWithAuthor[];
  currentUserId: string;
  canWriteComments: boolean;
  canModerate: boolean;
  showComments: boolean;
  invoiced?: boolean;
};

export type TreatmentProgressRecord = Pick<Treatment,
  "id" | "case_sheet_id" | "treatment_code" | "treatment_name" | "clinical_status" |
  "site_scope" | "site_detail" | "tooth_number" | "tooth_numbers" | "surfaces" |
  "notes" | "treated_at" | "performed_at"
> & {
  doctor: { full_name: string } | null;
  visit_remarks?: string | null;
  planned_treatment_id?: string | null;
  remaining_tooth_numbers?: string[];
};

export type TreatmentProgressGroup = {
  records: TreatmentProgressRecord[];
  total: number | null;
};

export type PatientTreatmentProgress = {
  planned: TreatmentProgressGroup;
  completed: TreatmentProgressGroup;
};

/** Labels for clinical records; pending plans are filtered by explicit completion links. */
export function treatmentProgressLabel(status: string | null): string {
  if (status === "planned") return "Yet to treat";
  if (status === "completed") return "Treated";
  return "Status not recorded";
}
