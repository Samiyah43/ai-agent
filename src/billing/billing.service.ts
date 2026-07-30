import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Plan, SubscriptionStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaidPlan } from './dto/create-checkout-session.dto';

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return SubscriptionStatus.ACTIVE;
    case 'canceled':
    case 'incomplete_expired':
    case 'paused':
      return SubscriptionStatus.CANCELED;
    default:
      // past_due, unpaid, incomplete: payment is failing/pending but Stripe
      // hasn't given up on the subscription yet.
      return SubscriptionStatus.PAST_DUE;
  }
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private stripeClient: Stripe | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // Built lazily so a deployment that hasn't configured Stripe yet (no
  // STRIPE_SECRET_KEY) can still boot and serve every other route — only an
  // actual billing call fails, not app startup.
  private get stripe(): Stripe {
    this.stripeClient ??= new Stripe(this.config.getOrThrow<string>('STRIPE_SECRET_KEY'));
    return this.stripeClient;
  }

  async createCheckoutSession(clientId: number, plan: PaidPlan): Promise<{ url: string }> {
    const client = await this.prisma.client.findUniqueOrThrow({ where: { id: clientId } });

    const customerId =
      client.stripeCustomerId ??
      (await this.stripe.customers.create({ metadata: { clientId: String(clientId) } })).id;

    if (!client.stripeCustomerId) {
      await this.prisma.client.update({ where: { id: clientId }, data: { stripeCustomerId: customerId } });
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: this.priceIdFor(plan), quantity: 1 }],
      success_url: this.config.getOrThrow<string>('BILLING_SUCCESS_URL'),
      cancel_url: this.config.getOrThrow<string>('BILLING_CANCEL_URL'),
      // Read back on checkout.session.completed so the webhook knows which
      // client/plan this session belongs to — Stripe has no concept of our
      // clientId otherwise.
      metadata: { clientId: String(clientId), plan },
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL.');
    }
    return { url: session.url };
  }

  // Verifies the raw request body against Stripe's signature header. Thrown
  // errors (bad/missing signature) are the caller's responsibility to turn
  // into an HTTP 400 — this only speaks Stripe SDK, not HTTP.
  constructEvent(payload: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
    );
  }

  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        this.logger.debug(`Ignoring unhandled Stripe event: ${event.type}`);
    }
  }

  private priceIdFor(plan: PaidPlan): string {
    return this.config.getOrThrow<string>(`STRIPE_PRICE_ID_${plan}`);
  }

  private planForPriceId(priceId: string): PaidPlan | null {
    if (priceId === this.config.get<string>('STRIPE_PRICE_ID_PRO')) return 'PRO';
    if (priceId === this.config.get<string>('STRIPE_PRICE_ID_BUSINESS')) return 'BUSINESS';
    return null;
  }

  private async onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const clientId = Number(session.metadata?.clientId);
    const plan = session.metadata?.plan as PaidPlan | undefined;
    if (!clientId || !plan) {
      this.logger.warn(`checkout.session.completed missing clientId/plan metadata (session ${session.id})`);
      return;
    }

    await this.prisma.client.update({
      where: { id: clientId },
      data: {
        stripeCustomerId: typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null),
        plan: plan as Plan,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      },
    });
  }

  private async onSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const client = await this.prisma.client.findUnique({ where: { stripeCustomerId: customerId } });
    if (!client) {
      this.logger.warn(`customer.subscription.updated for unknown Stripe customer ${customerId}`);
      return;
    }

    const priceId = subscription.items.data[0]?.price.id;
    const plan = (priceId ? this.planForPriceId(priceId) : null) ?? client.plan;

    await this.prisma.client.update({
      where: { id: client.id },
      data: { plan: plan as Plan, subscriptionStatus: mapStripeStatus(subscription.status) },
    });
  }

  private async onSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    await this.prisma.client.updateMany({
      where: { stripeCustomerId: customerId },
      data: { subscriptionStatus: SubscriptionStatus.CANCELED },
    });
  }
}
