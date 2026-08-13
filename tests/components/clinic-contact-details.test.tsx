import { afterEach, describe, expect, it } from "vitest";
import axe, { type AxeResults } from "axe-core";
import { cleanup, render, screen } from "@testing-library/react";
import { ClinicContactDetails } from "@/components/clinic-contact-details";

afterEach(cleanup);

async function expectNoSemanticViolations(
  container: HTMLElement
): Promise<void> {
  const results: AxeResults = await axe.run(container, {
    rules: {
      "color-contrast": { enabled: false },
    },
  });
  expect(
    results.violations,
    results.violations
      .map((violation) => `${violation.id}: ${violation.help}`)
      .join("\n")
  ).toEqual([]);
}

describe("clinic contact details", () => {
  it("renders the exact Tirupur address with accessible mobile contact actions", async () => {
    const { container } = render(<ClinicContactDetails />);

    const address = container.querySelector("address");
    expect(address).not.toBeNull();
    expect(screen.getByText("DR. KISHOR'S DENTISTRY - TIRUPUR"))
      .toBeInTheDocument();
    expect(
      screen.getByText(
        "No-541, 543/338-34, 1st floor, Aadhaar Hospital,"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("Opp to KR Bakes, Puspha Theatre Bus stop,")
    ).toBeInTheDocument();
    expect(screen.getByText("Tirupur – 641602.")).toBeInTheDocument();

    expect(
      screen.getByRole("link", {
        name: "Call Dr. Kishor's Dentistry Tirupur at 9361135459",
      })
    ).toHaveAttribute("href", "tel:+919361135459");

    const directions = screen.getByRole("link", {
      name: "Get directions to Dr. Kishor's Dentistry Tirupur (opens in a new tab)",
    });
    expect(directions).toHaveAttribute("target", "_blank");
    expect(directions).toHaveAttribute("rel", "noopener noreferrer");
    const directionsUrl = new URL(directions.getAttribute("href") ?? "");
    expect(directionsUrl.protocol).toBe("https:");
    expect(directionsUrl.hostname).toBe("www.google.com");

    await expectNoSemanticViolations(container);
  });

  it("can omit the repeated heading without hiding the address or actions", () => {
    const { container } = render(<ClinicContactDetails showName={false} />);

    expect(
      screen.queryByText("DR. KISHOR'S DENTISTRY - TIRUPUR")
    ).toBeNull();
    expect(container.querySelector("address")).toHaveTextContent(
      "Tirupur – 641602."
    );
    expect(screen.getByRole("link", { name: /^Call / })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Get directions / })
    ).toBeInTheDocument();
  });
});
