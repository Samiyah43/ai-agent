import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

const mockCustomersCreate = jest.fn();
const mockCheckoutSessionsCreate = jest.fn();
const mockConstructEvent = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: { create: mockCustomersCreate },
    checkout: { sessions: { create: mockCheckoutSessionsCreate } },
    webhooks: { constructEvent: mockConstructEvent },
  }));
});

const CONFIG_VALUES: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_PRICE_ID_PRO: 'price_pro',
  STRIPE_PRICE_ID_BUSINESS: 'price_business',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  BILLING_SUCCESS_URL: 'https://example.com/success',
  BILLING_CANCEL_URL: 'https://example.com/cancel',
};

function createConfigService(): ConfigService {
  return {
    get: jest.fn((key: string) => CONFIG_VALUES[key]),
    getOrThrow: jest.fn((key: string) => {
      const value = CONFIG_VALUES[key];
      if (value === undefined) throw new Error(`Missing config: ${key}`);
      return value;
    }),
  } as unknown as ConfigService;
}

// A tiny in-memory stand-in for PrismaService's `client` model, matching the
// style already used for ChatService/ApiKeyGuard tests in this project.
function createFakePrisma(client: Record<string, unknown>): PrismaService {
  return {
    client: {
      findUniqueOrThrow: jest.fn(async () => client),
      findUnique: jest.fn(async ({ where }: { where: { stripeCustomerId?: string } }) =>
        where.stripeCustomerId && where.stripeCustomerId === client.stripeCustomerId ? client : null,
      ),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(client, data);
        return client;
      }),
      updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(client, data);
        return { count: 1 };
      }),
    },
  } as unknown as PrismaService;
}

describe('BillingService', () => {
  beforeEach(() => {
    mockCustomersCreate.mockReset();
    mockCheckoutSessionsCreate.mockReset();
    mockConstructEvent.mockReset();
  });

  describe('createCheckoutSession', () => {
    it('creates a new Stripe customer and persists it when the client has none', async () => {
      const prisma = createFakePrisma({ id: 1, stripeCustomerId: null, plan: 'FREE', subscriptionStatus: 'NONE' });
      mockCustomersCreate.mockResolvedValue({ id: 'cus_new' });
      mockCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/session' });
      const service = new BillingService(prisma, createConfigService());

      const result = await service.createCheckoutSession(1, 'PRO');

      expect(mockCustomersCreate).toHaveBeenCalledWith({ metadata: { clientId: '1' } });
      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { stripeCustomerId: 'cus_new' },
      });
      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_new', line_items: [{ price: 'price_pro', quantity: 1 }] }),
      );
      expect(result).toEqual({ url: 'https://checkout.stripe.com/session' });
    });

    it('reuses an existing Stripe customer instead of creating a new one', async () => {
      const prisma = createFakePrisma({
        id: 2,
        stripeCustomerId: 'cus_existing',
        plan: 'FREE',
        subscriptionStatus: 'NONE',
      });
      mockCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/session2' });
      const service = new BillingService(prisma, createConfigService());

      await service.createCheckoutSession(2, 'BUSINESS');

      expect(mockCustomersCreate).not.toHaveBeenCalled();
      expect(prisma.client.update).not.toHaveBeenCalled();
      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_existing' }));
    });
  });

  describe('handleEvent', () => {
    it('activates the plan on checkout.session.completed', async () => {
      const prisma = createFakePrisma({ id: 5, stripeCustomerId: null, plan: 'FREE', subscriptionStatus: 'NONE' });
      const service = new BillingService(prisma, createConfigService());

      await service.handleEvent({
        type: 'checkout.session.completed',
        data: { object: { id: 'sess_1', customer: 'cus_5', metadata: { clientId: '5', plan: 'PRO' } } },
      } as unknown as Stripe.Event);

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { stripeCustomerId: 'cus_5', plan: 'PRO', subscriptionStatus: 'ACTIVE' },
      });
    });

    it('ignores checkout.session.completed with no clientId metadata', async () => {
      const prisma = createFakePrisma({ id: 5 });
      const service = new BillingService(prisma, createConfigService());

      await service.handleEvent({
        type: 'checkout.session.completed',
        data: { object: { id: 'sess_2', metadata: {} } },
      } as unknown as Stripe.Event);

      expect(prisma.client.update).not.toHaveBeenCalled();
    });

    it('updates plan and status on customer.subscription.updated', async () => {
      const prisma = createFakePrisma({ id: 7, stripeCustomerId: 'cus_7', plan: 'PRO', subscriptionStatus: 'ACTIVE' });
      const service = new BillingService(prisma, createConfigService());

      await service.handleEvent({
        type: 'customer.subscription.updated',
        data: {
          object: {
            customer: 'cus_7',
            status: 'past_due',
            items: { data: [{ price: { id: 'price_business' } }] },
          },
        },
      } as unknown as Stripe.Event);

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { plan: 'BUSINESS', subscriptionStatus: 'PAST_DUE' },
      });
    });

    it('marks the client canceled on customer.subscription.deleted', async () => {
      const prisma = createFakePrisma({ id: 9, stripeCustomerId: 'cus_9' });
      const service = new BillingService(prisma, createConfigService());

      await service.handleEvent({
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_9' } },
      } as unknown as Stripe.Event);

      expect(prisma.client.updateMany).toHaveBeenCalledWith({
        where: { stripeCustomerId: 'cus_9' },
        data: { subscriptionStatus: 'CANCELED' },
      });
    });
  });

  describe('constructEvent', () => {
    it('delegates to the Stripe SDK with the configured webhook secret', () => {
      const prisma = createFakePrisma({});
      const service = new BillingService(prisma, createConfigService());
      mockConstructEvent.mockReturnValue({ type: 'checkout.session.completed' });

      const payload = Buffer.from('{}');
      const event = service.constructEvent(payload, 'sig_123');

      expect(mockConstructEvent).toHaveBeenCalledWith(payload, 'sig_123', 'whsec_test');
      expect(event).toEqual({ type: 'checkout.session.completed' });
    });
  });
});
