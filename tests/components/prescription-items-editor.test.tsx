import { useState } from "react";
import axe, { type AxeResults } from "axe-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrescriptionItemsEditor } from "@/components/clinical/prescription-items-editor";
import {
  createPrescriptionItemDraft,
  MAX_PRESCRIPTION_ITEMS,
  type PrescriptionItemDraft,
} from "@/lib/prescriptions";

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

function Harness({ initial = [] }: { initial?: PrescriptionItemDraft[] }) {
  const [items, setItems] = useState(initial);
  return <PrescriptionItemsEditor value={items} onChange={setItems} />;
}

describe("PrescriptionItemsEditor", () => {
  it("adds, edits and removes a stable medicine line", () => {
    render(<Harness />);

    expect(screen.getByText("No medicines prescribed for this visit.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add medicine" }));

    const medicineName = screen.getByLabelText("Medicine name");
    fireEvent.change(medicineName, { target: { value: "Amoxicillin" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Morning" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Noon / lunch" }));
    fireEvent.change(screen.getByLabelText("Food timing"), { target: { value: "after_food" } });

    expect(medicineName).toHaveValue("Amoxicillin");
    expect(screen.getByRole("checkbox", { name: "Morning" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Noon / lunch" })).toBeChecked();
    expect(screen.getByLabelText("Food timing")).toHaveValue("after_food");
    expect(screen.getByText(`1 of ${MAX_PRESCRIPTION_ITEMS} medicines added`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove medicine 1, Amoxicillin" }));
    expect(screen.queryByLabelText("Medicine name")).toBeNull();
    expect(screen.getByText("No medicines prescribed for this visit.")).toBeInTheDocument();
  });

  it("disables adding after the visit reaches the medicine limit", () => {
    const items = Array.from({ length: MAX_PRESCRIPTION_ITEMS }, (_, index) => ({
      ...createPrescriptionItemDraft(`medicine-${index}`),
      medicine_name: `Medicine ${index + 1}`,
      morning: true,
    }));
    render(<Harness initial={items} />);

    expect(screen.getByRole("button", { name: "Add medicine" })).toBeDisabled();
    expect(screen.getByText(`The maximum of ${MAX_PRESCRIPTION_ITEMS} medicines has been reached.`))
      .toBeInTheDocument();
  });

  it("associates errors and retains accessible form semantics", async () => {
    const item = createPrescriptionItemDraft("medicine-1");
    const { container } = render(
      <PrescriptionItemsEditor
        value={[item]}
        onChange={() => undefined}
        errors={{
          "prescriptions.0.medicine_name": "Enter the medicine name",
          "prescriptions.0.morning": "Select at least one time of day",
        }}
      />,
    );

    expect(screen.getByRole("group", { name: "Prescription" })).toBeInTheDocument();
    expect(screen.getByLabelText("Medicine name"))
      .toHaveAccessibleDescription("Enter the medicine name");
    expect(screen.getByRole("group", { name: "When to take" }))
      .toHaveAccessibleDescription("Select at least one time of day");
    await expectNoSemanticViolations(container);
  });
});
