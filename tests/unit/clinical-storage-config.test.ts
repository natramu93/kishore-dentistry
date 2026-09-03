import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLINICAL_FILE_MIME_TYPES } from "@/lib/clinical-files";

describe("clinical Storage bucket configuration", () => {
  it("keeps clinical attachments private and aligned with application limits", () => {
    const config = readFileSync(
      join(process.cwd(), "supabase", "config.toml"),
      "utf8",
    );
    const bucket = config.match(
      /\[storage\.buckets\.clinical-attachments\]([\s\S]*?)(?=\n\[|$)/,
    )?.[1];

    expect(bucket).toBeDefined();
    expect(bucket).toMatch(/\bpublic\s*=\s*false\b/);
    expect(bucket).toMatch(/\bfile_size_limit\s*=\s*"25MiB"/);
    for (const mimeType of CLINICAL_FILE_MIME_TYPES) {
      expect(bucket).toContain(`"${mimeType}"`);
    }
  });
});
