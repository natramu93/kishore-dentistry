import { useState } from "react";
import axe, { type AxeResults } from "axe-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MedicalHistoryFields } from "@/components/patients/medical-history-fields";
import {
  createMedicalHistoryDraft,
  type MedicalHistoryDraft,
} from "@/lib/medical-history";

afterEach(cleanup);

async function expectNoSemanticViolations(container: HTMLElement): Promise<void> {
  const results: AxeResults = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    results.violations,
    results.violations.map((violation) => `${violation.id}: ${violation.help}`).join("\n"),
  ).toEqual([]);
}

function Harness({ initial }: { initial?: Partial<MedicalHistoryDraft> }) {
  const [history, setHistory] = useState(() => createMedicalHistoryDraft(initial));
  return (
    <MedicalHistoryFields
      value={history}
      onChange={setHistory}
    />
  );
}

describe("MedicalHistoryFields", () => {
  it("makes known conditions and no known conditions mutually exclusive", () => {
    render(<Harness />);

    const diabetes = screen.getByRole("checkbox", { name: "Diabetes" });
    const noKnown = screen.getByRole("checkbox", { name: "No known medical conditions" });

    fireEvent.click(diabetes);
    expect(diabetes).toBeChecked();
    expect(noKnown).not.toBeChecked();

    fireEvent.click(noKnown);
    expect(noKnown).toBeChecked();
    expect(diabetes).not.toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Heart condition" }));
    expect(noKnown).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Heart condition" })).toBeChecked();
  });

  it("requires the general description when Other condition is selected", () => {
    render(<Harness />);

    const description = screen.getByLabelText(/Medical history description/);
    expect(description).not.toBeRequired();

    fireEvent.click(screen.getByRole("checkbox", { name: "Other condition" }));

    expect(description).toBeRequired();
    expect(screen.getByText("Describe the other condition before the case sheet is finalized."))
      .toBeInTheDocument();
  });

  it("clears stale details and requires a fresh acknowledgement when no conditions are known", () => {
    render(<Harness initial={{
      conditions: ["diabetes"],
      description: "Controlled with medication",
      reviewedToday: true,
    }} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "No known medical conditions" }));

    expect(screen.getByLabelText(/Medical history description/)).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Reviewed with the patient today" }))
      .not.toBeChecked();
  });

  it("offers an explicit current-visit review acknowledgement", () => {
    render(<Harness />);

    const reviewedToday = screen.getByRole("checkbox", {
      name: "Reviewed with the patient today",
    });
    expect(reviewedToday).not.toBeChecked();
    fireEvent.click(reviewedToday);
    expect(reviewedToday).toBeChecked();
  });

  it("exposes native groups, labels, helper text and error associations", async () => {
    const history = createMedicalHistoryDraft();
    const { container } = render(
      <MedicalHistoryFields
        value={history}
        onChange={() => undefined}
        errors={{
          conditions: "Select a condition or confirm none are known",
          reviewedToday: "Confirm today’s review",
          description: "Describe the other medical condition",
        }}
      />,
    );

    expect(screen.getByRole("group", { name: "Medical history" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Known conditions" }))
      .toHaveAccessibleDescription("Select a condition or confirm none are known");
    expect(screen.getByLabelText(/Medical history description/))
      .toHaveAccessibleDescription(expect.stringContaining("Describe the other medical condition"));
    expect(screen.getByRole("checkbox", { name: "Reviewed with the patient today" }))
      .toHaveAccessibleDescription("Confirm today’s review");
    await expectNoSemanticViolations(container);
  });
});
