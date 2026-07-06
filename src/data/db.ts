import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// THE security boundary of this app (no RLS): the service-role client.
// Only modules inside src/data/ may import this — enforced by ESLint
// no-restricted-imports. Every exported data function must take an
// AuthContext and apply role/branch scoping itself.
export const db = createClient<Database, "crm">(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "crm" },
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

// Auth admin client (create/delete users). Same key, default schema.
export const authAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
).auth.admin;
