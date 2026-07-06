"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfileWithBranches } from "@/data/users";

export type LoginState = { error?: string; field?: "email" | "password" | "form" };

export async function login(
  _prev: LoginState | null,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email) return { error: "Enter your email address.", field: "email" };
  if (!password) return { error: "Enter your password.", field: "password" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Map Supabase auth errors to clear, specific messages
    const code = error.code ?? "";
    if (error.status === 400 || code === "invalid_credentials") {
      return { error: "The email or password you entered is incorrect.", field: "form" };
    }
    if (error.status === 429 || code === "over_request_rate_limit") {
      return { error: "Too many attempts. Please wait a minute and try again.", field: "form" };
    }
    if (code === "email_not_confirmed") {
      return { error: "This account hasn't been confirmed yet. Contact your administrator.", field: "form" };
    }
    return { error: "We couldn't sign you in right now. Please try again.", field: "form" };
  }

  // Block deactivated accounts at login (avoids a redirect loop mid-app)
  const profile = data.user ? await getProfileWithBranches(data.user.id) : null;
  if (!profile) {
    await supabase.auth.signOut();
    return { error: "No CRM profile is linked to this account. Contact your administrator.", field: "form" };
  }
  if (!profile.is_active) {
    await supabase.auth.signOut();
    return { error: "Your account has been deactivated. Contact your administrator.", field: "form" };
  }

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
