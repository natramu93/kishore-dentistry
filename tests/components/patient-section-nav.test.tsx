import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PatientSectionNav } from "@/components/patients/patient-section-nav";
import { CaseSheetEditLink } from "@/components/clinical/case-sheet-edit-link";

afterEach(cleanup);

describe("Patient section navigation", () => {
  it("uses real hash links without hiding or replacing patient sections", () => {
    render(<><PatientSectionNav sections={[
      { id: "patient-clinical", label: "Clinical" },
      { id: "patient-invoices", label: "Invoices" },
    ]} /><section id="patient-clinical">Clinical history</section><section id="patient-invoices">Invoice history</section></>);
    const nav = screen.getByRole("navigation", { name: "Patient sections" });
    expect(within(nav).getByRole("link", { name: "Clinical" })).toHaveAttribute("href", "#patient-clinical");
    expect(within(nav).getByRole("link", { name: "Invoices" })).toHaveAttribute("href", "#patient-invoices");
    expect(screen.getByText("Clinical history")).toBeVisible();
    expect(screen.getByText("Invoice history")).toBeVisible();
  });

  it("only includes sections explicitly supplied for the current role", () => {
    render(<PatientSectionNav sections={[{ id: "patient-clinical", label: "Clinical" }]} />);
    expect(screen.queryByRole("link", { name: "Invoices" })).not.toBeInTheDocument();
  });
});

describe("Case sheet edit link", () => {
  const finalizedAt = "2026-09-29T04:30:00Z";
  const finalized = Date.parse(finalizedAt);

  it("shows edit only during the allowed 24-hour window", () => {
    const { rerender } = render(<CaseSheetEditLink caseSheetId="sheet" finalizedAt={finalizedAt} canEdit now={finalized + 24 * 60 * 60 * 1000} />);
    expect(screen.getByRole("link", { name: "Edit case sheet" })).toHaveAttribute("href", "/case-sheets/sheet/edit");
    rerender(<CaseSheetEditLink caseSheetId="sheet" finalizedAt={finalizedAt} canEdit now={finalized + 24 * 60 * 60 * 1000 + 1} />);
    expect(screen.queryByRole("link", { name: "Edit case sheet" })).not.toBeInTheDocument();
    expect(screen.getByText(/24-hour edit window ended/)).toBeInTheDocument();
  });

  it("does not offer editing when role or ownership denies it", () => {
    render(<CaseSheetEditLink caseSheetId="sheet" finalizedAt={finalizedAt} canEdit={false} now={finalized} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("fails closed when the finalization time is invalid", () => {
    render(<CaseSheetEditLink caseSheetId="sheet" finalizedAt="invalid" canEdit now={finalized} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
  });
});
