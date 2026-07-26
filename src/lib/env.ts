const publicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function requiredPublicValue(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(
      `Missing ${name}. Configure the public Supabase environment before starting the app.`
    );
  }
  return value;
}

export function getPublicSupabaseEnv(): { url: string; anonKey: string } {
  const url = requiredPublicValue("NEXT_PUBLIC_SUPABASE_URL", publicSupabaseUrl);
  const anonKey = requiredPublicValue(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    publicSupabaseAnonKey
  );
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error();
  } catch {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must be a valid HTTPS URL (or localhost for development)."
    );
  }
  return { url, anonKey };
}
