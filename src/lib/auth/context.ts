import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfileWithBranches } from "@/data/users";
import type { UserRole } from "@/lib/database.types";
import { AuthorizationError } from "@/lib/errors";

const authContextBrand: unique symbol = Symbol("AuthContext");

export type AuthContext = Readonly<{
  readonly [authContextBrand]: true;
  userId: string;
  role: UserRole;
  branchIds: readonly string[];
  fullName: string;
  email: string;
  /** Set only for role "doctor" — the crm.doctors row linked to this login. */
  doctorId: string | null;
}>;

export { AuthorizationError };

// Cached per request. Validates the session JWT with Supabase (getUser, never
// getSession) and loads the profile + branch allocations.
export const getAuthContext = cache(async (): Promise<AuthContext> => {
  const supabase = await createClient();
  let userResult = await supabase.auth.getUser();
  let user = userResult.data.user;

  // A session cookie can be present (e.g. just set by the login redirect) while
  // the first getUser() network validation transiently fails — bouncing a
  // freshly-logged-in user back to /login. If a session cookie exists but no
  // user came back, retry once before giving up.
  if (!user && userResult.error && (userResult.error.status ?? 500) >= 500) {
    const cookieStore = await cookies();
    const hasSession = cookieStore
      .getAll()
      .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
    if (hasSession) {
      userResult = await supabase.auth.getUser();
      user = userResult.data.user;
    }
  }

  if (!user) redirect("/login");

  const profile = await getProfileWithBranches(user.id);
  if (!profile || !profile.is_active) redirect("/login?error=inactive");

  return Object.freeze({
    [authContextBrand]: true as const,
    userId: user.id,
    role: profile.role,
    branchIds: Object.freeze([...profile.branchIds]),
    fullName: profile.full_name,
    email: profile.email,
    doctorId: profile.doctorId,
  });
});
