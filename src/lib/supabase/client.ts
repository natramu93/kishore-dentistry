"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "@/lib/env";

// Browser client: AUTH ONLY. The crm schema has no grants for anon/authenticated
// roles — all data access goes through server components / server actions.
export function createClient() {
  const { url, anonKey } = getPublicSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
