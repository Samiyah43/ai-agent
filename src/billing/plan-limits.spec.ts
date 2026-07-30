import { getEffectivePlan, PLAN_LIMITS } from './plan-limits';

describe('getEffectivePlan', () => {
  it('returns the client plan when the subscription is active', () => {
    expect(getEffectivePlan({ plan: 'BUSINESS', subscriptionStatus: 'ACTIVE' })).toBe('BUSINESS');
  });

  it.each(['NONE', 'PAST_DUE', 'CANCELED'] as const)(
    'falls back to FREE when subscriptionStatus is %s',
    (status) => {
      expect(getEffectivePlan({ plan: 'PRO', subscriptionStatus: status })).toBe('FREE');
    },
  );
});

describe('PLAN_LIMITS', () => {
  it('grants higher request limits to higher plans', () => {
    expect(PLAN_LIMITS.FREE).toBeLessThan(PLAN_LIMITS.PRO);
    expect(PLAN_LIMITS.PRO).toBeLessThan(PLAN_LIMITS.BUSINESS);
  });
});
