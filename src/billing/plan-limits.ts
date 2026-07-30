import { Plan, SubscriptionStatus } from '../generated/prisma/client';

// Requests allowed per PLAN_LIMIT_TTL_MS window, enforced by ClientThrottlerGuard.
export const PLAN_LIMIT_TTL_MS = 60_000;
export const PLAN_LIMITS: Record<Plan, number> = {
  FREE: 20,
  PRO: 100,
  BUSINESS: 1000,
};

// A lapsed/past-due/canceled subscription loses its paid limits and falls
// back to FREE access — Stripe is still the source of truth for the
// underlying payment state (retrying, dunning, etc.), this just decides
// what the client is allowed to do *right now*.
export function getEffectivePlan(client: { plan: Plan; subscriptionStatus: SubscriptionStatus }): Plan {
  return client.subscriptionStatus === SubscriptionStatus.ACTIVE ? client.plan : Plan.FREE;
}
