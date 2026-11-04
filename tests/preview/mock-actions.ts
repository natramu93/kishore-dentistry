function capture(input: unknown) {
  window.dispatchEvent(new CustomEvent("preview-submit", { detail: input }));
  return Promise.resolve({ ok: true as const });
}
export const finalizeCaseSheetAction = capture;
export const amendCaseSheetAction = capture;
export const createInvoiceAndRedirect = capture;
export async function createInvoiceAction(input: unknown) {
  await capture(input);
  return { ok: true as const, data: { id: "preview-only" } };
}
export const updateInvoiceAction = (_id: unknown, input: unknown) => capture(input);
export const recordInvoicePaymentAction = capture;
export const recordInvoicePaymentsAction = (_id: unknown, input: unknown) => capture(input);
export async function confirmInvoiceCarryForwardAction(invoiceId: string) {
  await capture({ invoice_id: invoiceId, amount_received_now: 0, no_receipt_created: true });
  return { ok: true as const, balance: { amount_paid: 0, invoice_due: 800, earlier_due: 200, later_due: 0, overall_due: 1000, earlier_invoice_count: 1 } };
}
export const updateInvoicePaymentAction = (_id: unknown, _paymentId: unknown, input: unknown) => capture(input);

export const addCommentAction = capture;
export const archiveCommentAction = capture;
export const updateCommentAction = capture;
export async function prepareClinicalAttachmentsAction() { return { ok: false as const, error: "Uploads are disabled in the synthetic preview." }; }
export const prepareTreatmentAttachmentsAction = prepareClinicalAttachmentsAction;
export const confirmClinicalAttachmentAction = prepareClinicalAttachmentsAction;
export async function loadTreatmentDetailsAction(_leadId: string, treatmentId: string) {
  return { ok: true as const, details: {
    treatment: { id: treatmentId, case_sheet_id: "preview-sheet", treatment_code: "K02.9", treatment_name: "Preview dental care",
      clinical_status: "completed" as const, site_scope: "tooth" as const, site_detail: null, tooth_number: "16", tooth_numbers: ["16"], surfaces: [],
      notes: "Synthetic treatment note. No database connection.", treated_at: "2026-10-27T09:00:00Z", performed_at: "2026-10-27T09:00:00Z", doctor: { full_name: "Preview doctor" } },
    attachments: [], comments: [], filesAvailable: true, canUpload: false, currentUserId: "preview", canWriteComments: false, canModerate: false, showComments: false,
  } };
}
