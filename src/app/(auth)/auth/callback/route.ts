import { createClient } from "@/lib/supabase/server";

function redirectResponse(location: string) {
  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      Location: location,
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const supabase = await createClient();
  let destination: "/reset-password" | "/auth/set-password" | null = null;

  if (code && (type === null || type === "recovery" || type === "invite")) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      destination =
        type === "invite" ? "/auth/set-password" : "/reset-password";
    }
  } else if (tokenHash && (type === "recovery" || type === "invite")) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      destination =
        type === "invite" ? "/auth/set-password" : "/reset-password";
    }
  }

  if (destination) {
    return redirectResponse(destination);
  }

  return redirectResponse("/login?error=recovery");
}
