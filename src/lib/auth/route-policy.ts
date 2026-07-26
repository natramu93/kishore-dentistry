type AuthPathPolicy = Readonly<{
  allowWithoutSession: boolean;
  redirectAuthenticatedToDashboard: boolean;
}>;

function matchesPath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * Authentication route behavior is intentionally explicit. Callback and
 * password routes must remain reachable while an invite/recovery session is
 * being established, whereas MFA is authenticated-only and must never be
 * treated as a guest page.
 */
export function getAuthPathPolicy(pathname: string): AuthPathPolicy {
  if (
    matchesPath(pathname, "/login") ||
    matchesPath(pathname, "/auth/forgot-password")
  ) {
    return {
      allowWithoutSession: true,
      redirectAuthenticatedToDashboard: true,
    };
  }

  if (
    matchesPath(pathname, "/auth/callback") ||
    matchesPath(pathname, "/auth/set-password") ||
    matchesPath(pathname, "/reset-password")
  ) {
    return {
      allowWithoutSession: true,
      redirectAuthenticatedToDashboard: false,
    };
  }

  if (matchesPath(pathname, "/mfa")) {
    return {
      allowWithoutSession: false,
      redirectAuthenticatedToDashboard: false,
    };
  }

  return {
    allowWithoutSession: false,
    redirectAuthenticatedToDashboard: false,
  };
}
