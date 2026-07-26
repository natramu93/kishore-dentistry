import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getPublicSupabaseEnv } = await import("@/lib/env");
    getPublicSupabaseEnv();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  const reference = crypto.randomUUID();
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : undefined;

  console.error(
    JSON.stringify({
      level: "error",
      event: "request_error",
      reference,
      digest,
      method: request.method,
      route: context.routePath,
      routeType: context.routeType,
      router: context.routerKind,
    })
  );
};
