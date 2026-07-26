import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));

import { ResetPasswordForm } from "@/app/(auth)/reset-password/reset-password-form";

afterEach(cleanup);

describe("invitation and recovery password form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: mocks.getUser,
        updateUser: mocks.updateUser,
        signOut: mocks.signOut,
      },
    });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "verified-user" } },
      error: null,
    });
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("initializes and validates browser auth before enabling a fragment-invite update", async () => {
    render(<ResetPasswordForm />);

    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    const submit = screen.getByRole("button", { name: "Update password" });
    expect(submit).toBeDisabled();

    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "a-long-unique-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "a-long-unique-password" },
    });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mocks.updateUser).toHaveBeenCalledWith({
        password: "a-long-unique-password",
      });
      expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" });
      expect(mocks.replace).toHaveBeenCalledWith("/login?password=updated");
    });
  });

  it("keeps an expired or invalid link disabled", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { status: 401 },
    });
    render(<ResetPasswordForm />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "invalid or expired"
    );
    expect(
      screen.getByRole("button", { name: "Update password" })
    ).toBeDisabled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("falls back to local sign-out and surfaces a global revocation failure", async () => {
    mocks.signOut
      .mockResolvedValueOnce({ error: { status: 503 } })
      .mockResolvedValueOnce({ error: null });
    render(<ResetPasswordForm />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Update password" })
      ).toBeEnabled()
    );

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "a-long-unique-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "a-long-unique-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "other sessions could not be revoked"
    );
    expect(mocks.signOut).toHaveBeenNthCalledWith(1, { scope: "global" });
    expect(mocks.signOut).toHaveBeenNthCalledWith(2, { scope: "local" });
    expect(mocks.replace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Return to sign in" }));
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });

  it("does not redirect when both global and local sign-out fail", async () => {
    mocks.signOut.mockResolvedValue({ error: { status: 503 } });
    render(<ResetPasswordForm />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Update password" })
      ).toBeEnabled()
    );

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "a-long-unique-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "a-long-unique-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "automatic sign-out failed"
    );
    expect(
      screen.getByRole("button", { name: "Try signing out again" })
    ).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
