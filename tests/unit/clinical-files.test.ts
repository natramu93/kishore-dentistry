import { describe, expect, it } from "vitest";
import {
  MAX_CLINICAL_FILE_BYTES,
  clinicalFileBatchSchema,
  clinicalFileDisposition,
  matchesClinicalFileSignature,
  normalizeClinicalFileMime,
} from "@/lib/clinical-files";

function bytes(values: number[], length = values.length): Uint8Array {
  const result = new Uint8Array(length);
  result.set(values);
  return result;
}

describe("clinical file boundaries", () => {
  it("normalizes only known MIME aliases and safe extension fallbacks", () => {
    expect(normalizeClinicalFileMime("image/jpg", "photo.jpg")).toBe("image/jpeg");
    expect(normalizeClinicalFileMime("", "scan.DCM")).toBe("application/dicom");
    expect(normalizeClinicalFileMime("application/octet-stream", "photo.heic")).toBe(
      "image/heic"
    );
    expect(normalizeClinicalFileMime("text/html", "renamed.pdf")).toBeNull();
    expect(normalizeClinicalFileMime("", "payload.svg")).toBeNull();
  });

  it("enforces the 25 MB per-file limit and ten-file batch limit", () => {
    const valid = {
      original_name: "xray.png",
      mime_type: "image/png" as const,
      size_bytes: MAX_CLINICAL_FILE_BYTES,
      category: "xray" as const,
    };
    expect(clinicalFileBatchSchema.safeParse([valid]).success).toBe(true);
    expect(
      clinicalFileBatchSchema.safeParse([
        { ...valid, size_bytes: MAX_CLINICAL_FILE_BYTES + 1 },
      ]).success
    ).toBe(false);
    expect(
      clinicalFileBatchSchema.safeParse(Array.from({ length: 11 }, () => valid)).success
    ).toBe(false);
    expect(
      clinicalFileBatchSchema.safeParse([{ ...valid, original_name: "../xray.png" }])
        .success
    ).toBe(false);
  });

  it.each([
    ["image/jpeg", bytes([0xff, 0xd8, 0xff])],
    ["image/png", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    [
      "image/webp",
      bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    ],
    ["image/tiff", bytes([0x49, 0x49, 0x2a, 0x00])],
    [
      "image/heic",
      bytes([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
    ],
    ["application/pdf", bytes([0x25, 0x50, 0x44, 0x46, 0x2d])],
    [
      "application/dicom",
      (() => {
        const value = new Uint8Array(132);
        value.set([0x44, 0x49, 0x43, 0x4d], 128);
        return value;
      })(),
    ],
  ] as const)("recognizes a real %s signature", (mime, sample) => {
    expect(matchesClinicalFileSignature(mime, sample)).toBe(true);
  });

  it("rejects a renamed executable and downloads active document formats", () => {
    expect(
      matchesClinicalFileSignature(
        "application/pdf",
        bytes([0x4d, 0x5a, 0x90, 0x00])
      )
    ).toBe(false);
    expect(clinicalFileDisposition("patient report.pdf", "application/pdf")).toMatch(
      /^attachment;/
    );
    expect(clinicalFileDisposition("photo.jpg", "image/jpeg")).toMatch(/^inline;/);
    expect(clinicalFileDisposition('bad"\r\nname.pdf', "application/pdf")).not.toContain(
      '\r\n'
    );
  });
});
