"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/context";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { clinicalFileBatchSchema } from "@/lib/clinical-files";
import { uuidSchema } from "@/lib/validation";
import * as clinicalAttachments from "@/data/clinical-attachments";
import { runActionWithValue, type ActionValueResult } from "./util";

export async function prepareClinicalAttachmentsAction(
  caseSheetIdValue: unknown,
  filesValue: unknown
): Promise<
  ActionValueResult<{
    uploads: clinicalAttachments.PreparedClinicalAttachment[];
  }>
> {
  const ctx = await getAuthContext();
  const caseSheetId = uuidSchema.safeParse(caseSheetIdValue);
  const files = clinicalFileBatchSchema.safeParse(filesValue);
  if (!caseSheetId.success) {
    return { ok: false, error: "Case sheet is invalid" };
  }
  if (!files.success) {
    return {
      ok: false,
      error: files.error.issues[0]?.message ?? "Clinical files are invalid",
    };
  }

  return runActionWithValue(async () => {
    await assertActionRateLimit(ctx.userId, "clinical-file:prepare", {
      limit: 12,
      windowMs: 5 * 60_000,
    });
    const uploads = await clinicalAttachments.prepareClinicalAttachments(
      ctx,
      caseSheetId.data,
      files.data
    );
    return { uploads };
  });
}

export async function confirmClinicalAttachmentAction(
  attachmentIdValue: unknown
): Promise<
  ActionValueResult<{
    attachment: clinicalAttachments.ClinicalAttachmentRecord;
  }>
> {
  const ctx = await getAuthContext();
  const attachmentId = uuidSchema.safeParse(attachmentIdValue);
  if (!attachmentId.success) {
    return { ok: false, error: "Clinical file is invalid" };
  }

  return runActionWithValue(async () => {
    await assertActionRateLimit(ctx.userId, "clinical-file:confirm", {
      limit: 60,
      windowMs: 5 * 60_000,
    });
    const attachment = await clinicalAttachments.confirmClinicalAttachment(
      ctx,
      attachmentId.data
    );
    revalidatePath(`/leads/${attachment.lead_id}`);
    revalidatePath(`/my-patients/${attachment.lead_id}`);
    return { attachment };
  });
}
