import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LegacyBillHistory } from "@/components/patients/legacy-bill-history";

afterEach(cleanup);
const service = { branch_id: "billing-center", billing_branch: { name: "Original billing center" }, bill_number: "SYN-1", billed_at: "2025-10-01T08:30:00+05:30", service_names: ["Synthetic cleaning"] };
const bill = { ...service, gross_paise: 100000, discount_paise: 20000, tax_paise: 0, net_paise: 80000,
  service_lines: [
    { service: "Synthetic cleaning", net_paise: 60000, source_payment_type: "UPI" },
    { service: "Synthetic follow-up", net_paise: 10000, source_payment_type: "cash" },
    { service: "Synthetic exam", net_paise: 10000, source_payment_type: "upi" },
  ] };

describe("historical bills", () => {
  it("shows source amounts and does not present payment or collection actions", () => {
    render(<LegacyBillHistory pathname="/patients/synthetic" query={{ page: "2" }}
      history={{ records: [bill], page: 1, pageSize: 15, total: 16 }} />);
    expect(screen.getByText(/Bill SYN-1/)).toHaveTextContent("₹800.00");
    expect(screen.getByText(/Bill SYN-1/)).toHaveTextContent("Original billing center");
    expect(screen.getByText(/Bill SYN-1/)).toHaveTextContent("Billed ₹800.00");
    expect(screen.getByText("Payment unverified")).toBeInTheDocument();
    expect(screen.getByText("Payment method listed in the original export: UPI, Cash. This is not a receipt.")).toBeInTheDocument();
    expect(screen.getByText(/do not affect current balances/)).toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Next"})).toHaveAttribute("href", "/patients/synthetic?page=2&legacyPage=2#legacy-bill-history");
    expect(screen.queryByRole("button", {name: /pay|collect/i})).not.toBeInTheDocument();
  });

  it("shows doctors service labels without any financial details", () => {
    render(<LegacyBillHistory pathname="/my-patients/synthetic" query={{}} clinicalOnly
      history={{ records: [bill], page: 1, pageSize: 15, total: 1 }} />);
    expect(screen.getByText("Synthetic cleaning")).toBeInTheDocument();
    expect(screen.getByText(/not signed case sheets/)).toBeInTheDocument();
    expect(screen.queryByText(/₹|SYN-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Payment unverified|original export: UPI/)).not.toBeInTheDocument();
  });

  it("does not invent a receipt or payment method when the export has none", () => {
    render(<LegacyBillHistory pathname="/patients/synthetic" query={{}}
      history={{ records: [{ ...bill, service_lines: [{ service: "Synthetic cleaning", net_paise: 80000, source_payment_type: "null" }] }], page: 1, pageSize: 15, total: 1 }} />);
    expect(screen.getByText("Payment unverified")).toBeInTheDocument();
    expect(screen.queryByText(/Payment method listed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Amount received|Paid:/)).not.toBeInTheDocument();
  });
});
