import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// THE security boundary of this app (no RLS): the service-role client.
// Only modules inside src/data/ may import this — enforced by ESLint
// no-restricted-imports. Every exported data function must take an
// AuthContext and apply role/branch scoping itself.
//
// The client is created LAZILY (on first use) rather than at module load.
// The service-role key is a RUNTIME-only secret and is absent during the
// production build (e.g. Firebase App Hosting's Cloud Build) — eager
// creation would throw "supabaseKey is required" while Next collects page
// data. Deferring construction keeps the build clean and the key runtime-only.

type CrmClient = SupabaseClient<Database, "crm">;

let _db: CrmClient | null = null;
function getDb(): CrmClient {
  if (!_db) {
    _db = createClient<Database, "crm">(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { db: { schema: "crm" }, auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _db;
}

function lazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop, receiver) {
      const real = resolve() as object;
      const value = Reflect.get(real, prop, receiver);
      return typeof value === "function" ? value.bind(real) : value;
    },
  });
}

export const db: CrmClient = lazyProxy(getDb);

// Auth admin client (create/delete users). Same key, default schema.
type AuthAdmin = ReturnType<typeof createClient>["auth"]["admin"];

let _authAdmin: AuthAdmin | null = null;
function getAuthAdmin(): AuthAdmin {
  if (!_authAdmin) {
    _authAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    ).auth.admin;
  }
  return _authAdmin;
}

export const authAdmin: AuthAdmin = lazyProxy(getAuthAdmin);
