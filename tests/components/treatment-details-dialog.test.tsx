import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { loadTreatmentDetailsAction } from "@/actions/treatment-details";
import { TreatmentDetailsDialog } from "@/components/clinical/treatment-details-dialog";
import type { TreatmentDetails } from "@/lib/treatment-progress";

vi.mock("@/actions/treatment-details", () => ({ loadTreatmentDetailsAction: vi.fn() }));
vi.mock("@/components/clinical/clinical-attachment-panel", () => ({ ClinicalAttachmentPanel: () => <section aria-label="Treatment files">Attachment controls</section> }));
vi.mock("@/components/comment-thread", () => ({ CommentThread: ({ onChanged }: { onChanged: () => void }) => <button onClick={onChanged}>Comment saved</button> }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
const details = {
  treatment: { id: "treatment", case_sheet_id: "sheet", surfaces: [], site_detail: null, treatment_code: "27.41", treatment_name: "Dental care", clinical_status: "completed",
    site_scope: "not_applicable", tooth_number: null, tooth_numbers: [], notes: "Detailed clinical note",
    performed_at: "2026-10-27T09:00:00Z", treated_at: "2026-10-27T09:00:00Z", doctor: { full_name: "Dr Test" } },
  attachments: [], comments: [], filesAvailable: true, canUpload: true, currentUserId: "staff",
  canWriteComments: true, canModerate: true, showComments: true,
} as TreatmentDetails;
const view = () => render(<TreatmentDetailsDialog leadId="patient" treatmentId="treatment" name="Dental care">Treatment summary</TreatmentDetailsDialog>);

describe("on-demand treatment details", () => {
  it("keeps details/files hidden until the treatment card is clicked, then refreshes after comments", async () => {
    vi.mocked(loadTreatmentDetailsAction).mockResolvedValue({ ok: true, details });
    view();
    expect(loadTreatmentDetailsAction).not.toHaveBeenCalled();
    expect(screen.queryByText("Detailed clinical note")).toBeNull();
    expect(screen.queryByRole("region", { name: "Treatment files" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View treatment details: Dental care" }));
    await waitFor(() => expect(screen.getByText("Detailed clinical note")).toBeVisible());
    expect(screen.getByRole("dialog", { name: "Dental care" })).toBeInTheDocument();
    expect(loadTreatmentDetailsAction).toHaveBeenCalledWith("patient", "treatment");
    expect(screen.getByRole("region", { name: "Treatment files" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Comment saved" }));
    await waitFor(() => expect(loadTreatmentDetailsAction).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "View treatment details: Dental care" }));
    await waitFor(() => expect(loadTreatmentDetailsAction).toHaveBeenCalledTimes(3));
  });

  it("shows a recoverable error instead of making the card inactive", async () => {
    vi.mocked(loadTreatmentDetailsAction).mockResolvedValueOnce({ ok: false, error: "Unable to load treatment" })
      .mockResolvedValueOnce({ ok: true, details });
    view(); fireEvent.click(screen.getByRole("button", { name: "View treatment details: Dental care" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unable to load treatment"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Detailed clinical note")).toBeVisible());
  });
});
