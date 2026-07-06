import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfileWithBranches } from "@/data/users";
import type { UserRole } from "@/lib/database.types";

export type AuthContext = {
  userId: string;
  role: UserRole;
  branchIds: string[];
  fullName: string;
  email: string;
};

export class AuthorizationError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthorizationError";
  }
}

// Cached per request. Validates the session JWT with Supabase (getUser, never
// getSession) and loads the profile + branch allocations.
export const getAuthContext = cache(async (): Promise<AuthContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const profile = await getProfileWithBranches(user.id);
  if (!profile || !profile.is_active) redirect("/login?error=inactive");

  return {
    userId: user.id,
    role: profile.role,
    branchIds: profile.branchIds,
    fullName: profile.full_name,
    email: profile.email,
  };
});
