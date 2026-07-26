import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getAuthenticatorAssuranceLevel: vi.fn(),
  listFactors: vi.fn(),
  unenroll: vi.fn(),
  enroll: vi.fn(),
  challengeAndVerify: vi.fn(),
  signOut: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel:
          mocks.getAuthenticatorAssuranceLevel,
        listFactors: mocks.listFactors,
        unenroll: mocks.unenroll,
        enroll: mocks.enroll,
        challengeAndVerify: mocks.challengeAndVerify,
      },
      signOut: mocks.signOut,
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));

import { MfaForm } from "@/app/(auth)/mfa/mfa-form";

afterEach(cleanup);

const aal1 = {
  data: {
    currentLevel: "aal1",
    nextLevel: "aal2",
    currentAuthenticationMethods: [],
  },
  error: null,
};

const aal2 = {
  data: {
    currentLevel: "aal2",
    nextLevel: "aal2",
    currentAuthenticationMethods: [],
  },
  error: null,
};

const verifiedFactor = {
  id: "verified-factor",
  factor_type: "totp",
  status: "verified",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("privileged MFA form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatorAssuranceLevel
      .mockResolvedValueOnce(aal1)
      .mockResolvedValue(aal2);
    mocks.listFactors.mockResolvedValue({
      data: {
        all: [verifiedFactor],
        totp: [verifiedFactor],
        phone: [],
        webauthn: [],
      },
      error: null,
    });
    mocks.challengeAndVerify.mockResolvedValue({
      data: {},
      error: null,
    });
    mocks.unenroll.mockResolvedValue({ data: {}, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("challenges a verified factor and continues only after AAL2 is confirmed", async () => {
    render(<MfaForm />);

    expect(
      await screen.findByRole("heading", {
        name: "Enter your authenticator code",
      })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Six-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Verify and continue" })
    );

    await waitFor(() => {
      expect(mocks.challengeAndVerify).toHaveBeenCalledWith({
        factorId: "verified-factor",
        code: "123456",
      });
      expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("starts enrollment only from a user gesture and replaces stale unverified TOTP", async () => {
    const staleFactor = {
      ...verifiedFactor,
      id: "stale-factor",
      status: "unverified",
    };
    mocks.listFactors.mockResolvedValue({
      data: {
        all: [staleFactor],
        totp: [],
        phone: [],
        webauthn: [],
      },
      error: null,
    });
    mocks.enroll.mockResolvedValue({
      data: {
        id: "new-factor",
        type: "totp",
        totp: {
          qr_code: "data:image/svg+xml;utf-8,<svg></svg>",
          secret: "SAFEBASE32SECRET",
          uri: "otpauth://totp/example",
        },
      },
      error: null,
    });

    render(<MfaForm />);

    const startButton = await screen.findByRole("button", {
      name: "Start setup",
    });
    expect(mocks.enroll).not.toHaveBeenCalled();
    fireEvent.click(startButton);

    expect(
      await screen.findByAltText(
        "QR code for adding this CRM account to an authenticator app"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("SAFEBASE32SECRET")).toBeInTheDocument();
    expect(mocks.unenroll).toHaveBeenCalledWith({
      factorId: "stale-factor",
    });
    expect(mocks.enroll).toHaveBeenCalledWith({
      factorType: "totp",
      friendlyName: "CRM authenticator",
      issuer: "Dr. Kishor's Dentistry CRM",
    });
  });

  it("rejects malformed codes locally without creating a challenge", async () => {
    render(<MfaForm />);
    await screen.findByRole("heading", {
      name: "Enter your authenticator code",
    });

    fireEvent.change(screen.getByLabelText("Six-digit code"), {
      target: { value: "12345a" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Verify and continue" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter the six-digit code"
    );
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });
});
