import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  confirm: vi.fn(),
  upload: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/actions/clinical-attachments", () => ({
  prepareClinicalAttachmentsAction: mocks.prepare,
  confirmClinicalAttachmentAction: mocks.confirm,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({ uploadToSignedUrl: mocks.upload }),
    },
  }),
}));

import { ClinicalAttachmentPanel } from "@/components/clinical/clinical-attachment-panel";
import type { ClinicalAttachmentView } from "@/lib/clinical-files";

const caseSheetId = "10000000-0000-4000-8000-000000000001";
const attachment: ClinicalAttachmentView = {
  id: "10000000-0000-4000-8000-000000000002",
  case_sheet_id: caseSheetId,
  lead_id: "10000000-0000-4000-8000-000000000003",
  branch_id: "10000000-0000-4000-8000-000000000004",
  category: "photograph",
  bucket_id: "clinical-attachments",
  original_name: "chairside.jpg",
  mime_type: "image/jpeg",
  size_bytes: 3,
  status: "ready",
  uploaded_at: "2026-09-03T05:00:00.000Z",
  created_at: "2026-09-03T05:00:00.000Z",
};

beforeEach(() => {
  mocks.prepare.mockReset().mockResolvedValue({
    ok: true,
    uploads: [
      {
        id: attachment.id,
        bucket_id: "clinical-attachments",
        object_path: `${attachment.branch_id}/${attachment.lead_id}/${caseSheetId}/${attachment.id}.jpg`,
        token: "short-lived-token",
        mime_type: "image/jpeg",
        original_name: attachment.original_name,
      },
    ],
  });
  mocks.confirm.mockReset().mockResolvedValue({ ok: true, attachment });
  mocks.upload.mockReset().mockResolvedValue({ data: {}, error: null });
  mocks.refresh.mockReset();
});

afterEach(cleanup);

describe("clinical attachment panel", () => {
  it("uploads through a signed token, verifies, and renders the secure link", async () => {
    render(<ClinicalAttachmentPanel caseSheetId={caseSheetId} />);
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "chairside.jpg", {
      type: "image/jpeg",
      lastModified: 1,
    });
    fireEvent.change(screen.getByLabelText("Choose clinical files"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add 1 file" }));

    await waitFor(() => {
      expect(mocks.prepare).toHaveBeenCalledWith(caseSheetId, [
        {
          original_name: "chairside.jpg",
          mime_type: "image/jpeg",
          size_bytes: 3,
          category: "photograph",
        },
      ]);
      expect(mocks.upload).toHaveBeenCalledWith(
        expect.stringContaining(`${attachment.id}.jpg`),
        "short-lived-token",
        file,
        { cacheControl: "0", contentType: "image/jpeg" }
      );
      expect(mocks.confirm).toHaveBeenCalledWith(attachment.id);
    });

    const link = await screen.findByRole("link", {
      name: /chairside\.jpg.*open secure clinical file/i,
    });
    expect(link).toHaveAttribute("href", `/clinical-files/${attachment.id}`);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("blocks unsupported or oversized files before creating metadata", () => {
    render(<ClinicalAttachmentPanel caseSheetId={caseSheetId} />);
    const file = new File(["<svg></svg>"], "active.svg", {
      type: "image/svg+xml",
    });
    fireEvent.change(screen.getByLabelText("Choose clinical files"), {
      target: { files: [file] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("not a supported");
    expect(screen.getByRole("button", { name: "Add files" })).toBeDisabled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("renders existing private files accessibly", async () => {
    render(
      <ClinicalAttachmentPanel
        caseSheetId={caseSheetId}
        initialAttachments={[attachment]}
        canUpload={false}
      />
    );

    expect(screen.getByText("Photograph · 3 B")).toBeInTheDocument();
    expect(screen.queryByLabelText("Choose clinical files")).toBeNull();
    const accessibility = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      accessibility.violations,
      accessibility.violations
        .map((violation) => `${violation.id}: ${violation.help}`)
        .join("\n")
    ).toEqual([]);
  });
});
