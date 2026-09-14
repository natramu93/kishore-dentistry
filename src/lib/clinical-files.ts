import { z } from "zod";

export const CLINICAL_ATTACHMENT_BUCKET = "clinical-attachments" as const;
export const MAX_CLINICAL_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_CLINICAL_FILES_PER_BATCH = 10;

export const CLINICAL_ATTACHMENT_CATEGORIES = [
  "photograph",
  "xray",
  "scan",
  "report",
  "other",
] as const;

export type ClinicalAttachmentCategory =
  (typeof CLINICAL_ATTACHMENT_CATEGORIES)[number];

export const CLINICAL_ATTACHMENT_CATEGORY_LABELS: Record<
  ClinicalAttachmentCategory,
  string
> = {
  photograph: "Photograph",
  xray: "X-ray",
  scan: "Scan",
  report: "Report",
  other: "Other",
};

export const CLINICAL_FILE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "application/pdf",
  "application/dicom",
] as const;

export type ClinicalFileMimeType = (typeof CLINICAL_FILE_MIME_TYPES)[number];

const allowedMimeTypes = new Set<string>(CLINICAL_FILE_MIME_TYPES);
const mimeAliases: Record<string, ClinicalFileMimeType> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/tif": "image/tiff",
  "application/x-dicom": "application/dicom",
};

const extensionMimeTypes: Record<string, ClinicalFileMimeType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  dcm: "application/dicom",
  dicom: "application/dicom",
};

const mimeExtensions: Record<ClinicalFileMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/tiff": "tiff",
  "application/pdf": "pdf",
  "application/dicom": "dcm",
};

export const CLINICAL_FILE_ACCEPT = [
  ...CLINICAL_FILE_MIME_TYPES,
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".pdf",
  ".dcm",
].join(",");

export const clinicalAttachmentCategorySchema = z.enum(
  CLINICAL_ATTACHMENT_CATEGORIES
);

export const clinicalFileDescriptorSchema = z.object({
  original_name: z
    .string()
    .trim()
    .min(1, "File name is required")
    .max(255, "File name is too long")
    .refine(
      (value) => !/[\\/\u0000-\u001f\u007f]/.test(value),
      "File name contains unsupported characters"
    ),
  mime_type: z.enum(CLINICAL_FILE_MIME_TYPES),
  size_bytes: z
    .number()
    .int()
    .min(1, "Empty files cannot be uploaded")
    .max(MAX_CLINICAL_FILE_BYTES, "Each clinical file must be 25 MB or smaller"),
  category: clinicalAttachmentCategorySchema,
});

export const clinicalFileBatchSchema = z
  .array(clinicalFileDescriptorSchema)
  .min(1, "Choose at least one file")
  .max(
    MAX_CLINICAL_FILES_PER_BATCH,
    `Upload no more than ${MAX_CLINICAL_FILES_PER_BATCH} files at a time`
  );

export type ClinicalFileDescriptor = z.infer<typeof clinicalFileDescriptorSchema>;

export type ClinicalAttachmentView = {
  id: string;
  case_sheet_id: string;
  treatment_id: string | null;
  lead_id: string;
  branch_id: string;
  category: ClinicalAttachmentCategory;
  bucket_id: typeof CLINICAL_ATTACHMENT_BUCKET;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  status: "pending" | "ready" | "failed";
  uploaded_at: string | null;
  created_at: string;
};

/**
 * Older hosted databases may still be on the case-sheet attachment schema
 * without treatment ownership. Keep signed case-sheet reads available while
 * the additive treatment-attachment migration is being rolled out. This is
 * intentionally narrow: callers must only use it to select a legacy read
 * projection, never to bypass authorization or enable writes.
 */
export function isTreatmentAttachmentSchemaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code ?? "") : "";
  const message = "message" in error ? String(error.message ?? "") : "";
  return (
    code === "42703" ||
    (code === "PGRST200" &&
      /case_sheet_attachments|treatment_attachments|treatment_id/i.test(message))
  );
}

function extensionOf(fileName: string): string {
  const finalDot = fileName.lastIndexOf(".");
  return finalDot >= 0 ? fileName.slice(finalDot + 1).toLowerCase() : "";
}

/** Normalize browser MIME aliases and infer only well-known clinical extensions. */
export function normalizeClinicalFileMime(
  browserMime: string | null | undefined,
  fileName: string
): ClinicalFileMimeType | null {
  const normalized = browserMime?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (allowedMimeTypes.has(normalized)) return normalized as ClinicalFileMimeType;
  if (mimeAliases[normalized]) return mimeAliases[normalized];

  // Browsers commonly report DICOM/HEIC as blank or octet-stream. Only infer
  // from the extension for those non-specific values, never for a conflicting
  // declared content type.
  if (!normalized || normalized === "application/octet-stream") {
    return extensionMimeTypes[extensionOf(fileName)] ?? null;
  }
  return null;
}

export function clinicalFileExtension(mimeType: ClinicalFileMimeType): string {
  return mimeExtensions[mimeType];
}

function hasBytes(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

/**
 * Lightweight server-side signature verification. This rejects renamed or
 * content-type-spoofed files before metadata is marked ready. It is not a
 * malware scanner, so downloads still use no-store/nosniff and PDFs download
 * rather than execute inline.
 */
export function matchesClinicalFileSignature(
  mimeType: ClinicalFileMimeType,
  bytes: Uint8Array
): boolean {
  switch (mimeType) {
    case "image/jpeg":
      return bytes.length >= 3 && hasBytes(bytes, 0, [0xff, 0xd8, 0xff]);
    case "image/png":
      return (
        bytes.length >= 8 &&
        hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
    case "image/webp":
      return (
        bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP"
      );
    case "image/tiff":
      return (
        bytes.length >= 4 &&
        (hasBytes(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) ||
          hasBytes(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a]))
      );
    case "image/heic":
    case "image/heif": {
      if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") return false;
      const brand = ascii(bytes, 8, 4);
      return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(
        brand
      );
    }
    case "application/pdf":
      return bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-";
    case "application/dicom":
      if (bytes.length >= 132 && ascii(bytes, 128, 4) === "DICM") return true;
      // DICOM permits a missing 128-byte preamble. In that form, accept common
      // first data-set groups in little or big endian form.
      return (
        bytes.length >= 4 &&
        (hasBytes(bytes, 0, [0x02, 0x00]) ||
          hasBytes(bytes, 0, [0x08, 0x00]) ||
          hasBytes(bytes, 0, [0x10, 0x00]) ||
          hasBytes(bytes, 0, [0x00, 0x02]) ||
          hasBytes(bytes, 0, [0x00, 0x08]) ||
          hasBytes(bytes, 0, [0x00, 0x10]))
      );
  }
}

export function formatClinicalFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function clinicalFileDisposition(
  fileName: string,
  mimeType: ClinicalFileMimeType
): string {
  const disposition = mimeType.startsWith("image/") ? "inline" : "attachment";
  const safeUnicode = fileName
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .trim()
    .slice(0, 255) || "clinical-file";
  const fallback =
    safeUnicode
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["'();\\/\r\n]/g, "_")
      .trim()
      .slice(0, 180) || "clinical-file";
  const encoded = encodeURIComponent(safeUnicode).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
