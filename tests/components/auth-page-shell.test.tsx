import { afterEach, describe, expect, it } from "vitest";
import axe, { type AxeResults } from "axe-core";
import { cleanup, render, screen } from "@testing-library/react";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { TIRUPUR_CLINIC } from "@/lib/clinic";

afterEach(cleanup);

async function expectNoSemanticViolations(container: HTMLElement): Promise<void> {
  const results: AxeResults = await axe.run(container, {
    rules: {
      // jsdom has no layout or paint engine, so it cannot evaluate contrast.
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

describe("AuthPageShell", () => {
  it("links the main landmark to its heading and description and composes page content", async () => {
    const { container } = render(
      <AuthPageShell
        title="Reset your password"
        description="We will email a short-lived recovery link."
        footer={<a href="/login">Back to sign in</a>}
      >
        <form aria-label="Recovery form">
          <button type="submit">Send recovery link</button>
        </form>
      </AuthPageShell>
    );

    const main = screen.getByRole("main");
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Reset your password",
    });
    const description = screen.getByText(
      "We will email a short-lived recovery link."
    );

    expect(main).toHaveAttribute("aria-labelledby", heading.id);
    expect(main).toHaveAttribute("aria-describedby", description.id);
    expect(screen.getByRole("form", { name: "Recovery form" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/login"
    );
    expect(container.querySelector("footer")).toContainElement(
      screen.getByRole("link", { name: "Back to sign in" })
    );

    const logo = screen.getByRole("img", { name: TIRUPUR_CLINIC.brandName });
    expect(logo).toHaveAttribute("src", expect.stringContaining("logo-on-navy"));

    await expectNoSemanticViolations(container);
  });

  it("omits the optional footer when no footer content is supplied", () => {
    const { container } = render(
      <AuthPageShell title="Set your password" description="Choose a secure password.">
        <div>Account setup form</div>
      </AuthPageShell>
    );

    expect(screen.getByText("Account setup form")).toBeInTheDocument();
    expect(container.querySelector("footer")).toBeNull();
  });
});
