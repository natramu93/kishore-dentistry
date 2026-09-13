import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import LoginPage from "@/app/(auth)/login/page";
import { TIRUPUR_CLINIC } from "@/lib/clinic";

vi.mock("@/actions/auth", () => ({
  login: vi.fn(),
}));

afterEach(cleanup);

describe("login page", () => {
  it("shows a branded message and login fields without a cover photo or address", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) });
    const { container } = render(page);

    expect(screen.queryByRole("img", {
      name: `Clinical team at ${TIRUPUR_CLINIC.brandName}, Tirupur`,
    })).not.toBeInTheDocument();
    expect(screen.getByText("One place for every patient journey.")).toBeVisible();
    expect(
      screen.getByRole("form", { name: "Sign in to the clinic CRM" })
    ).toBeInTheDocument();
    expect(container.querySelector("address")).toBeNull();
    expect(container.querySelector('img[src*="tirupur-dental-operatory"]')).toBeNull();
  });
});
