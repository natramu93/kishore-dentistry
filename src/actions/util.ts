import { PublicError } from "@/lib/errors";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionValueResult<T extends object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function actionFailure(error: unknown): { ok: false; error: string } {
  if (error instanceof PublicError) {
    return { ok: false, error: error.message };
  }

  const reference = crypto.randomUUID();
  console.error(`Server Action failed [${reference}]`, error);
  return {
    ok: false,
    error: `Something went wrong. Please try again. Reference: ${reference}`,
  };
}

/** Uniform error envelope so forms can render failures without crashing. */
export async function runAction(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function runActionWithValue<T extends object>(
  fn: () => Promise<T>
): Promise<ActionValueResult<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (error) {
    return actionFailure(error);
  }
}
