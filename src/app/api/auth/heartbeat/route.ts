import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Compatibility endpoint for older tabs; checks auth without an idle policy. */
export async function POST() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return new Response(null, { status: 204 });
}
