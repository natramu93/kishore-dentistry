"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser client: AUTH ONLY. The crm schema has no grants for anon/authenticated
// roles — all data access goes through server components / server actions.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
