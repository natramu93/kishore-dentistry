import "server-only";

import { consumeActionRateLimit } from "@/data/rate-limits";
import { RateLimitError } from "@/lib/errors";

/**
 * Atomically enforce a per-user, per-scope limit shared by every application
 * instance. Database/RPC failures deliberately propagate, so mutations fail
 * closed instead of silently falling back to a weaker instance-local limit.
 */
export async function assertActionRateLimit(
  userId: string,
  scope: string,
  options: { limit: number; windowMs: number }
): Promise<void> {
  if (!(await consumeActionRateLimit(userId, scope, options))) {
    throw new RateLimitError();
  }
}
