import { describe, expect, it } from "vitest";
import { getAuthPathPolicy } from "@/lib/auth/route-policy";

describe("authentication route policy", () => {
  it.each(["/login", "/auth/forgot-password"])(
    "keeps %s accessible as a stable authentication recovery route",
    (pathname) => {
      expect(getAuthPathPolicy(pathname)).toEqual({
        allowWithoutSession: true,
      });
    }
  );

  it.each([
    "/auth/callback",
    "/auth/set-password",
    "/reset-password",
  ])(
    "allows both sides of an in-progress callback/password flow at %s",
    (pathname) => {
      expect(getAuthPathPolicy(pathname)).toEqual({
        allowWithoutSession: true,
      });
    }
  );

  it.each([
    "/dashboard",
    "/api/reports",
    "/authentication-lookalike",
    "/auth/callback-evil",
    "/login-evil",
  ])(
    "protects ordinary and lookalike paths such as %s",
    (pathname) => {
      expect(getAuthPathPolicy(pathname)).toEqual({
        allowWithoutSession: false,
      });
    }
  );
});
