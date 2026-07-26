import "server-only";

import { db } from "./db";

/**
 * The durable rate-limit adapter lives in the DAL so the service-role client
 * remains behind the same server-only boundary as every other CRM query.
 */
export async function consumeActionRateLimit(
  actorId: string,
  scope: string,
  options: { limit: number; windowMs: number }
): Promise<boolean> {
  const { data, error } = await db.rpc("consume_action_rate_limit", {
    p_actor: actorId,
    p_scope: scope,
    p_limit: options.limit,
    p_window_ms: options.windowMs,
  });
  if (error) throw error;
  return data === true;
}
