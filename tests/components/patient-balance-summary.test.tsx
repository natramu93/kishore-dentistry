import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { PatientBalanceSummary } from "@/components/invoices/patient-balance-summary";
afterEach(cleanup);
describe("patient-wide invoice dues", () => {
  it("separates earlier debt from the current invoice and links to the original bills", () => {
    render(<PatientBalanceSummary leadId="patient-1" balance={{ amount_paid: 200, invoice_due: 300, earlier_due: 1000, later_due: 0, overall_due: 1300, earlier_invoice_count: 2 }} />);
    const panel = screen.getByRole("region", { name: "Patient outstanding balance" });
    expect(within(panel).getByText("Earlier unpaid bills (2)")).toBeInTheDocument();
    expect(within(panel).getByText("₹1,300.00")).toBeInTheDocument();
    expect(within(panel).getByText(/not billed again/)).toBeInTheDocument();
    expect(within(panel).queryByText("Newer unpaid bills")).toBeNull();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/leads/patient-1#patient-invoices");
  });
  it("explains later debt when reviewing an older invoice", () => {
    render(<PatientBalanceSummary leadId="patient-1" balance={{ amount_paid: 500, invoice_due: 0, earlier_due: 0, later_due: 500, overall_due: 500, earlier_invoice_count: 0 }} />);
    expect(screen.getByText("Newer unpaid bills")).toBeInTheDocument();
  });
});
