"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfileWithBranches } from "@/data/users";

export type LoginState = { error?: string; field?: "email" | "password" | "form" };

export async function login(
  _prev: LoginState | null,
  formData: FormData
): Promise<LoginState> {
  const parsed = z
    .object({
      email: z.string().trim().email().max(254),
      password: z.string().min(1).max(128),
    })
    .safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
  if (!parsed.success) {
    const emailIssue = parsed.error.issues.some((issue) => issue.path[0] === "email");
    return emailIssue
      ? { error: "Enter a valid email address.", field: "email" }
      : { error: "Enter your password.", field: "password" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

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
  let profile: Awaited<ReturnType<typeof getProfileWithBranches>> = null;
  try {
    profile = data.user ? await getProfileWithBranches(data.user.id) : null;
  } catch (profileError) {
    const reference = crypto.randomUUID();
    console.error(`Profile lookup failed during login [${reference}]`, profileError);
    await supabase.auth.signOut();
    return {
      error: `We couldn't finish signing you in. Please try again. Reference: ${reference}`,
      field: "form",
    };
  }
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
