import "server-only";

import { getPublicSupabaseEnv } from "@/lib/env";

export function getServerSupabaseEnv(): {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
} {
  const publicEnv = getPublicSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey?.trim()) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Configure the runtime-only Supabase service-role secret."
    );
  }
  if (serviceRoleKey === publicEnv.anonKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY must not be the public Supabase anonymous key."
    );
  }
  return { ...publicEnv, serviceRoleKey };
}
