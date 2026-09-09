import "server-only";

import { cache } from "react";
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

// Cached per request. Validates the session JWT with Supabase getClaims()
// (never getSession) and loads the profile + branch allocations. getClaims()
// avoids a redundant Auth user request after Proxy has already refreshed the
// session, which keeps concurrent page loads from exhausting Auth requests.
export const getAuthContext = cache(async (): Promise<AuthContext> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string" || !userId) redirect("/login");

  const profile = await getProfileWithBranches(userId);
  if (!profile || !profile.is_active) redirect("/login?error=inactive");

  return Object.freeze({
    [authContextBrand]: true as const,
    userId,
    role: profile.role,
    branchIds: Object.freeze([...profile.branchIds]),
    fullName: profile.full_name,
    email: profile.email,
    doctorId: profile.doctorId,
  });
});
