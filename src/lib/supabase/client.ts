"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "@/lib/env";

// Browser client: Auth plus short-lived, server-issued signed Storage uploads.
// The crm schema has no grants for anon/authenticated roles, and the browser
// never receives the service-role key. All CRM data access goes through server
// components/actions; signed upload tokens are scoped to one random object.
export function createClient() {
  const { url, anonKey } = getPublicSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
