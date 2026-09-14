import "server-only";

import { createHash } from "node:crypto";
import { db, storageAdmin } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import type { CaseSheetAttachment } from "@/lib/database.types";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  CLINICAL_ATTACHMENT_BUCKET,
  clinicalFileBatchSchema,
  clinicalFileExtension,
  matchesClinicalFileSignature,
  type ClinicalAttachmentView,
  type ClinicalFileDescriptor,
  type ClinicalFileMimeType,
} from "@/lib/clinical-files";
import { assertUuid } from "@/lib/validation";
import { canReadLead } from "@/lib/auth/guards";

type CaseSheetScope = {
  id: string;
  lead_id: string;
  branch_id: string;
  doctor_id: string;
  finalized_at: string;
  assignee_id: string | null;
  treatment_id: string | null;
};

export type ClinicalAttachmentRecord = ClinicalAttachmentView;

export type PreparedClinicalAttachment = {
  id: string;
  bucket_id: typeof CLINICAL_ATTACHMENT_BUCKET;
  object_path: string;
  token: string;
  mime_type: ClinicalFileMimeType;
  original_name: string;
};

function toAttachmentRecord(
  attachment: CaseSheetAttachment
): ClinicalAttachmentRecord {
  return {
    id: attachment.id,
    case_sheet_id: attachment.case_sheet_id,
    treatment_id: attachment.treatment_id,
    lead_id: attachment.lead_id,
    branch_id: attachment.branch_id,
    category: attachment.category,
    bucket_id: attachment.bucket_id,
    original_name: attachment.original_name,
    mime_type: attachment.mime_type,
    size_bytes: attachment.size_bytes,
    status: attachment.status,
    uploaded_at: attachment.uploaded_at,
    created_at: attachment.created_at,
  };
}

function assertScopeAccess(ctx: AuthContext, scope: CaseSheetScope): void {
  if (ctx.role === "admin") return;
  if (ctx.role === "clinical_head" && ctx.branchIds.includes(scope.branch_id)) {
    return;
  }
  if (
    (ctx.role === "operations" || ctx.role === "front_office") &&
    canReadLead(ctx, {
      branch_id: scope.branch_id,
      assignee_id: scope.assignee_id,
    })
  ) {
    return;
  }
  if (
    ctx.role === "doctor" &&
    ctx.doctorId !== null &&
    ctx.doctorId === scope.doctor_id
  ) {
    return;
  }
  throw new AuthorizationError("Clinical attachment access required");
}

async function requireCaseSheetScope(
  ctx: AuthContext,
  caseSheetIdValue: string
): Promise<CaseSheetScope> {
  const caseSheetId = assertUuid(caseSheetIdValue, "Case sheet");
  const { data, error } = await db
    .from("case_sheets")
    .select("id, lead_id, branch_id, doctor_id, finalized_at, lead:leads!inner(assignee_id, deleted_at)")
    .eq("id", caseSheetId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.finalized_at || !data.lead || data.lead.deleted_at) {
    throw new NotFoundError("Signed case sheet");
  }
  const scope = {
    ...data,
    assignee_id: data.lead.assignee_id,
    treatment_id: null,
  } as unknown as CaseSheetScope;
  assertScopeAccess(ctx, scope);
  return scope;
}

async function requireTreatmentScope(
  ctx: AuthContext,
  treatmentIdValue: string
): Promise<CaseSheetScope> {
  const treatmentId = assertUuid(treatmentIdValue, "Treatment");
  const { data, error } = await db
    .from("treatments")
    .select(
      "id, lead_id, branch_id, case_sheet_id, case_sheet:case_sheets!inner(id, lead_id, branch_id, doctor_id, finalized_at, lead:leads!inner(assignee_id, deleted_at))"
    )
    .eq("id", treatmentId)
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as {
    id: string;
    lead_id: string;
    branch_id: string;
    case_sheet_id: string | null;
    case_sheet: {
      id: string;
      lead_id: string;
      branch_id: string;
      doctor_id: string;
      finalized_at: string | null;
      lead: { assignee_id: string | null; deleted_at: string | null } | null;
    } | null;
  } | null;
  const sheet = row?.case_sheet;
  if (
    !row ||
    !row.case_sheet_id ||
    !sheet ||
    !sheet.finalized_at ||
    !sheet.lead ||
    sheet.lead.deleted_at ||
    row.lead_id !== sheet.lead_id ||
    row.branch_id !== sheet.branch_id
  ) {
    throw new NotFoundError("Finalized treatment");
  }
  const scope: CaseSheetScope = {
    id: sheet.id,
    lead_id: sheet.lead_id,
    branch_id: sheet.branch_id,
    doctor_id: sheet.doctor_id,
    finalized_at: sheet.finalized_at,
    assignee_id: sheet.lead.assignee_id,
    treatment_id: row.id,
  };
  assertScopeAccess(ctx, scope);
  return scope;
}

async function requireAttachment(
  ctx: AuthContext,
  attachmentIdValue: string
): Promise<CaseSheetAttachment> {
  const attachmentId = assertUuid(attachmentIdValue, "Clinical file");
  const { data, error } = await db
    .from("case_sheet_attachments")
    .select("*")
    .eq("id", attachmentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Clinical file");
  const attachment = data as CaseSheetAttachment;
  if (attachment.treatment_id) {
    await requireTreatmentScope(ctx, attachment.treatment_id);
  } else {
    await requireCaseSheetScope(ctx, attachment.case_sheet_id);
  }
  return attachment;
}

export async function listClinicalAttachmentsForCaseSheet(
  ctx: AuthContext,
  caseSheetId: string
): Promise<ClinicalAttachmentRecord[]> {
  const scope = await requireCaseSheetScope(ctx, caseSheetId);
  const { data, error } = await db
    .from("case_sheet_attachments")
    .select(
      "id, case_sheet_id, treatment_id, lead_id, branch_id, category, bucket_id, original_name, mime_type, size_bytes, status, uploaded_at, created_at"
    )
    .eq("case_sheet_id", scope.id)
    .is("treatment_id", null)
    .eq("status", "ready")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ClinicalAttachmentRecord[];
}

export async function listClinicalAttachmentsForTreatment(
  ctx: AuthContext,
  treatmentId: string
): Promise<ClinicalAttachmentRecord[]> {
  const scope = await requireTreatmentScope(ctx, treatmentId);
  const { data, error } = await db
    .from("case_sheet_attachments")
    .select(
      "id, case_sheet_id, treatment_id, lead_id, branch_id, category, bucket_id, original_name, mime_type, size_bytes, status, uploaded_at, created_at"
    )
    .eq("case_sheet_id", scope.id)
    .eq("treatment_id", scope.treatment_id ?? "")
    .eq("status", "ready")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ClinicalAttachmentRecord[];
}

/** Efficient page helper; every case sheet is authorized before the file query. */
export async function listClinicalAttachmentsForCaseSheets(
  ctx: AuthContext,
  caseSheetIdsValue: readonly string[]
): Promise<Record<string, ClinicalAttachmentRecord[]>> {
  const caseSheetIds = [...new Set(caseSheetIdsValue)].map((id) =>
    assertUuid(id, "Case sheet")
  );
  if (caseSheetIds.length === 0) return {};
  if (caseSheetIds.length > 100) {
    throw new ValidationError("Too many case sheets were requested");
  }

  const { data: scopes, error: scopeError } = await db
    .from("case_sheets")
    .select("id, lead_id, branch_id, doctor_id, finalized_at, lead:leads!inner(assignee_id, deleted_at)")
    .in("id", caseSheetIds);
  if (scopeError) throw scopeError;
  if ((scopes?.length ?? 0) !== caseSheetIds.length) {
    throw new NotFoundError("Signed case sheet");
  }
  for (const row of scopes ?? []) {
    const lead = (row as unknown as { lead: { assignee_id: string | null; deleted_at: string | null } | null }).lead;
    const scope = {
      ...(row as unknown as Omit<CaseSheetScope, "assignee_id">),
      assignee_id: lead?.assignee_id ?? null,
      treatment_id: null,
    } as CaseSheetScope;
    if (!scope.finalized_at || !lead || lead.deleted_at) {
      throw new NotFoundError("Signed case sheet");
    }
    assertScopeAccess(ctx, scope);
  }
  const { data, error } = await db
    .from("case_sheet_attachments")
    .select(
      "id, case_sheet_id, treatment_id, lead_id, branch_id, category, bucket_id, original_name, mime_type, size_bytes, status, uploaded_at, created_at"
    )
    .in("case_sheet_id", caseSheetIds)
    .is("treatment_id", null)
    .eq("status", "ready")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1_000);
  if (error) throw error;

  const grouped = Object.fromEntries(caseSheetIds.map((id) => [id, []])) as Record<
    string,
    ClinicalAttachmentRecord[]
  >;
  for (const row of (data ?? []) as ClinicalAttachmentRecord[]) {
    grouped[row.case_sheet_id]?.push(row);
  }
  return grouped;
}

async function markPendingFailedAndRemove(
  attachment: Pick<CaseSheetAttachment, "id" | "bucket_id" | "object_path">
): Promise<boolean> {
  const { data, error } = await db
    .from("case_sheet_attachments")
    .update({ status: "failed", uploaded_at: null, sha256_hex: null })
    .eq("id", attachment.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;

  const { error: removeError } = await storageAdmin
    .from(attachment.bucket_id)
    .remove([attachment.object_path]);
  if (removeError) {
    console.error("Unable to remove rejected clinical object", {
      attachmentId: attachment.id,
      error: removeError,
    });
  }
  return true;
}

async function prepareAttachmentsForScope(
  ctx: AuthContext,
  scope: CaseSheetScope,
  files: readonly ClinicalFileDescriptor[]
): Promise<PreparedClinicalAttachment[]> {
  const parsedFiles = clinicalFileBatchSchema.safeParse(files);
  if (!parsedFiles.success) {
    throw new ValidationError(
      parsedFiles.error.issues[0]?.message ?? "Clinical files are invalid"
    );
  }
  const rows = parsedFiles.data.map((file) => {
    const id = crypto.randomUUID();
    const objectPath = scope.treatment_id
      ? `${scope.branch_id}/${scope.lead_id}/${scope.id}/treatments/${scope.treatment_id}/${id}.${clinicalFileExtension(file.mime_type)}`
      : `${scope.branch_id}/${scope.lead_id}/${scope.id}/${id}.${clinicalFileExtension(file.mime_type)}`;
    return {
      id,
      case_sheet_id: scope.id,
      treatment_id: scope.treatment_id,
      lead_id: scope.lead_id,
      branch_id: scope.branch_id,
      category: file.category,
      bucket_id: CLINICAL_ATTACHMENT_BUCKET,
      object_path: objectPath,
      original_name: file.original_name,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      status: "pending" as const,
      uploaded_at: null,
      sha256_hex: null,
      created_by: ctx.userId,
    };
  });

  const { error: insertError } = await db
    .from("case_sheet_attachments")
    .insert(rows);
  if (insertError) throw insertError;

  try {
    const signed = await Promise.all(
      rows.map((row) =>
        storageAdmin
          .from(CLINICAL_ATTACHMENT_BUCKET)
          .createSignedUploadUrl(row.object_path, { upsert: false })
      )
    );
    return signed.map((result, index) => {
      const row = rows[index];
      if (!row || result.error || !result.data?.token) {
        throw result.error ?? new Error("Upload token was not returned");
      }
      return {
        id: row.id,
        bucket_id: CLINICAL_ATTACHMENT_BUCKET,
        object_path: row.object_path,
        token: result.data.token,
        mime_type: row.mime_type,
        original_name: row.original_name,
      };
    });
  } catch (error) {
    await Promise.all(
      rows.map((row) =>
        markPendingFailedAndRemove({
          id: row.id,
          bucket_id: row.bucket_id,
          object_path: row.object_path,
        })
      )
    );
    throw error;
  }
}

export async function prepareClinicalAttachments(
  ctx: AuthContext,
  caseSheetId: string,
  files: readonly ClinicalFileDescriptor[]
): Promise<PreparedClinicalAttachment[]> {
  return prepareAttachmentsForScope(
    ctx,
    await requireCaseSheetScope(ctx, caseSheetId),
    files
  );
}

export async function prepareTreatmentAttachments(
  ctx: AuthContext,
  treatmentId: string,
  files: readonly ClinicalFileDescriptor[]
): Promise<PreparedClinicalAttachment[]> {
  return prepareAttachmentsForScope(
    ctx,
    await requireTreatmentScope(ctx, treatmentId),
    files
  );
}

export async function confirmClinicalAttachment(
  ctx: AuthContext,
  attachmentId: string
): Promise<ClinicalAttachmentRecord> {
  const attachment = await requireAttachment(ctx, attachmentId);
  if (attachment.status === "ready") return toAttachmentRecord(attachment);
  if (attachment.status !== "pending") {
    throw new ConflictError("This clinical file upload has already failed");
  }

  try {
    const bucket = storageAdmin.from(attachment.bucket_id);
    const { data: info, error: infoError } = await bucket.info(attachment.object_path);
    if (infoError || !info) throw infoError ?? new Error("File metadata was not returned");

    const storedMime = info.contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (info.size !== attachment.size_bytes || storedMime !== attachment.mime_type) {
      throw new ValidationError(
        "The uploaded file did not match the selected file. Please choose it again."
      );
    }

    const { data: blob, error: downloadError } = await bucket.download(
      attachment.object_path,
      {},
      { cache: "no-store" }
    );
    if (downloadError || !blob) {
      throw downloadError ?? new Error("Uploaded file could not be read");
    }
    if (blob.size !== attachment.size_bytes) {
      throw new ValidationError("The uploaded file size could not be verified");
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (
      !matchesClinicalFileSignature(
        attachment.mime_type as ClinicalFileMimeType,
        bytes
      )
    ) {
      throw new ValidationError(
        "The file contents do not match its format. Please choose the original clinical file."
      );
    }
    const sha256Hex = createHash("sha256").update(bytes).digest("hex");

    const { data: ready, error: updateError } = await db
      .from("case_sheet_attachments")
      .update({
        status: "ready",
        uploaded_at: new Date().toISOString(),
        sha256_hex: sha256Hex,
      })
      .eq("id", attachment.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (updateError) throw updateError;
    if (ready) return toAttachmentRecord(ready as CaseSheetAttachment);

    // An idempotent retry can race with the first confirmation.
    const current = await requireAttachment(ctx, attachment.id);
    if (current.status === "ready") return toAttachmentRecord(current);
    throw new ConflictError("This clinical file could not be completed");
  } catch (error) {
    const transitioned = await markPendingFailedAndRemove(attachment);
    if (!transitioned) {
      const current = await requireAttachment(ctx, attachment.id);
      if (current.status === "ready") return toAttachmentRecord(current);
    }
    if (error instanceof ValidationError || error instanceof ConflictError) throw error;
    console.error("Clinical file verification failed", {
      attachmentId: attachment.id,
      error,
    });
    throw new ValidationError(
      "The clinical file could not be verified. Please choose it again."
    );
  }
}

export async function downloadClinicalAttachment(
  ctx: AuthContext,
  attachmentId: string
): Promise<{ attachment: ClinicalAttachmentRecord; blob: Blob }> {
  const attachment = await requireAttachment(ctx, attachmentId);
  if (attachment.status !== "ready" || !attachment.uploaded_at) {
    throw new NotFoundError("Clinical file");
  }
  const { data: blob, error } = await storageAdmin
    .from(attachment.bucket_id)
    .download(attachment.object_path, {}, { cache: "no-store" });
  if (error || !blob) throw error ?? new Error("Clinical file could not be read");
  if (blob.size !== attachment.size_bytes) {
    throw new ConflictError("The stored clinical file could not be verified");
  }
  if (!attachment.sha256_hex) {
    throw new ConflictError("The stored clinical file has no integrity fingerprint");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sha256Hex = createHash("sha256").update(bytes).digest("hex");
  if (sha256Hex !== attachment.sha256_hex) {
    throw new ConflictError("The stored clinical file failed its integrity check");
  }
  return { attachment, blob };
}
