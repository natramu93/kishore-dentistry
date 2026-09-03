import { getAuthContext } from "@/lib/auth/context";
import { downloadClinicalAttachment } from "@/data/clinical-attachments";
import {
  clinicalFileDisposition,
  normalizeClinicalFileMime,
} from "@/lib/clinical-files";
import { ConflictError, PublicError } from "@/lib/errors";
import { assertActionRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function publicErrorStatus(error: PublicError): number {
  switch (error.code) {
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "RATE_LIMITED":
      return 429;
    case "CONFLICT":
      return 409;
    default:
      return 400;
  }
}

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  // Authentication stays outside error mapping so an expired session keeps the
  // application's normal login redirect instead of becoming a file error.
  const ctx = await getAuthContext();

  try {
    await assertActionRateLimit(ctx.userId, "clinical-file:download", {
      limit: 60,
      windowMs: 60_000,
    });
    const { id } = await context.params;
    const { attachment, blob } = await downloadClinicalAttachment(ctx, id);
    const mimeType = normalizeClinicalFileMime(
      attachment.mime_type,
      attachment.original_name
    );
    if (!mimeType || mimeType !== attachment.mime_type) {
      throw new ConflictError("The stored clinical file type is invalid");
    }

    return new Response(blob, {
      status: 200,
      headers: {
        ...privateHeaders,
        "Content-Disposition": clinicalFileDisposition(
          attachment.original_name,
          mimeType
        ),
        "Content-Length": String(attachment.size_bytes),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": mimeType,
      },
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json(
        { error: error.message },
        { status: publicErrorStatus(error), headers: privateHeaders }
      );
    }

    const reference = crypto.randomUUID();
    console.error(`Clinical file download failed [${reference}]`, error);
    return Response.json(
      {
        error: `Unable to open this clinical file. Please try again. Reference: ${reference}`,
      },
      { status: 500, headers: privateHeaders }
    );
  }
}
