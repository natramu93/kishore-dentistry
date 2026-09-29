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
