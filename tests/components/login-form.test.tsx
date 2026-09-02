import { afterEach, describe, expect, it, vi } from "vitest";
import axe, { type AxeResults } from "axe-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LoginForm } from "@/app/(auth)/login/login-form";

vi.mock("@/actions/auth", () => ({
  login: vi.fn(),
}));

afterEach(cleanup);

async function expectNoSemanticViolations(container: HTMLElement): Promise<void> {
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

describe("login form", () => {
  it("provides mobile-friendly credential fields and password visibility control", async () => {
    const { container } = render(<LoginForm />);

    const email = screen.getByRole("textbox", { name: "Email address" });
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("inputmode", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toHaveAttribute("autocapitalize", "none");
    expect(email).toHaveAttribute("autocorrect", "off");
    expect(email).toHaveAttribute("enterkeyhint", "next");

    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toHaveAttribute("enterkeyhint", "go");

    const visibilityButton = screen.getByRole("button", { name: "Show password" });
    expect(visibilityButton).toHaveAttribute("type", "button");
    expect(visibilityButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(visibilityButton);

    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Sign in securely" })).toHaveAttribute(
      "type",
      "submit"
    );
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      "/auth/forgot-password"
    );

    await expectNoSemanticViolations(container);
  });

  it("announces account and recovery errors and associates them with both fields", () => {
    const { rerender } = render(<LoginForm inactiveError />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your account has been deactivated"
    );
    expect(screen.getByRole("textbox", { name: "Email address" })).toHaveAttribute(
      "aria-describedby",
      "login-credentials-help login-error"
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-describedby",
      "login-credentials-help login-error"
    );

    rerender(<LoginForm recoveryError />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "invalid or expired"
    );
  });

  it("reports a successful password reset without an error role", () => {
    render(<LoginForm passwordUpdated />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Password updated"
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
