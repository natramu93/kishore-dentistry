import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LegacyBillHistory } from "@/components/patients/legacy-bill-history";

afterEach(cleanup);
const service = { bill_number: "SYN-1", billed_at: "2025-10-01T08:30:00+05:30", service_names: ["Synthetic cleaning"] };
const bill = { ...service, gross_paise: 100000, discount_paise: 20000, tax_paise: 0, net_paise: 80000,
  service_lines: [{ service: "Synthetic cleaning", net_paise: 80000 }] };

describe("historical bills", () => {
  it("shows source amounts and does not present payment or collection actions", () => {
    render(<LegacyBillHistory pathname="/patients/synthetic" query={{ page: "2" }}
      history={{ records: [bill], page: 1, pageSize: 15, total: 16 }} />);
    expect(screen.getByText(/Bill SYN-1/)).toHaveTextContent("₹800.00");
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
  });
});
