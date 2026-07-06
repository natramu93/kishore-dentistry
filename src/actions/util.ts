import { AuthorizationError } from "@/lib/auth/context";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Uniform error envelope so forms can render failures without crashing. */
export async function runAction(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, error: e.message };
    if (e instanceof Error) {
      // Surface DB constraint messages tersely; log the rest server-side
      console.error("Action failed:", e);
      return { ok: false, error: e.message };
    }
    return { ok: false, error: "Something went wrong" };
  }
}
