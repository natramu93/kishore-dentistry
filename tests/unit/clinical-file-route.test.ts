import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  download: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: mocks.auth,
}));
vi.mock("@/data/clinical-attachments", () => ({
  downloadClinicalAttachment: mocks.download,
}));
vi.mock("@/lib/rate-limit", () => ({
  assertActionRateLimit: mocks.rateLimit,
}));

import { GET } from "@/app/(app)/clinical-files/[id]/route";
import { AuthorizationError } from "@/lib/errors";

const id = "10000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id }) };
const attachment = {
  id,
  case_sheet_id: "10000000-0000-4000-8000-000000000002",
  lead_id: "10000000-0000-4000-8000-000000000003",
  branch_id: "10000000-0000-4000-8000-000000000004",
  category: "report" as const,
  bucket_id: "clinical-attachments" as const,
  original_name: "Patient report.pdf",
  mime_type: "application/pdf",
  size_bytes: 5,
  status: "ready" as const,
  uploaded_at: "2026-09-03T05:00:00.000Z",
  created_at: "2026-09-03T05:00:00.000Z",
};

beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ userId: "user-1" });
  mocks.rateLimit.mockReset().mockResolvedValue(undefined);
  mocks.download.mockReset().mockResolvedValue({
    attachment,
    blob: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], {
      type: "application/pdf",
    }),
  });
});

describe("clinical file download route", () => {
  it("serves active documents as private same-origin downloads", async () => {
    const response = await GET(new Request(`https://clinic.test/clinical-files/${id}`), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(mocks.rateLimit).toHaveBeenCalledWith("user-1", "clinical-file:download", {
      limit: 60,
      windowMs: 60_000,
    });
    expect(mocks.download).toHaveBeenCalledWith(expect.anything(), id);
  });

  it("maps authorization failures without exposing an object", async () => {
    mocks.download.mockRejectedValueOnce(new AuthorizationError("No clinical access"));
    const response = await GET(new Request(`https://clinic.test/clinical-files/${id}`), context);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "No clinical access" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
