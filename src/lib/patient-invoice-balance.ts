/** Current ledger balances, not additional charges on this invoice. */
export type PatientInvoiceBalance = {
  amount_paid: number;
  invoice_due: number;
  earlier_due: number;
  later_due: number;
  overall_due: number;
  earlier_invoice_count: number;
};
