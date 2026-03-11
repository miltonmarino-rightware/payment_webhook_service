/**
 * Stripe Payment Operator Service
 *
 * Handles Stripe payment operations:
 * - Creating payment intents for card payments
 * - Processing Stripe webhook events
 * - Managing payment state transitions
 *
 * This service is isolated from mPesa and other operators.
 * Security/compliance middleware is applied at the route level.
 *
 * LEGAL COMPLIANCE NOTICE:
 * This service does NOT handle, store, or move money.
 * Money flows directly from customer → Stripe → merchant.
 * This service only orchestrates payment intents and maintains audit trails.
 */

import * as db from "../../db";
import Stripe from "stripe";
import crypto from "crypto";

/**
 * Stripe payment intent creation request
 */
export interface StripePaymentIntentRequest {
  transactionId: string;
  externalSystemId: string;
  externalSystemWebhook: string;
  amount: number; // in cents (e.g., 500 = $5.00)
  currency: string; // ISO 4217 code (e.g., "USD", "EUR")
  description: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
}

/**
 * Stripe payment intent response
 */
export interface StripePaymentIntentResponse {
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  status:
    | "requires_payment_method"
    | "requires_confirmation"
    | "requires_action"
    | "processing"
    | "succeeded"
    | "canceled";
  createdAt: Date;
}

/**
 * Stripe webhook event types we handle
 */
export enum StripeEventType {
  PAYMENT_INTENT_CREATED = "payment_intent.created",
  PAYMENT_INTENT_SUCCEEDED = "payment_intent.succeeded",
  PAYMENT_INTENT_PAYMENT_FAILED = "payment_intent.payment_failed",
  PAYMENT_INTENT_CANCELED = "payment_intent.canceled",
  CHARGE_REFUNDED = "charge.refunded",
}

/**
 * Stripe webhook event
 */
export interface StripeWebhookEvent {
  id: string;
  type: StripeEventType;
  created: number;
  data: {
    object: {
      id: string;
      object: string;
      amount: number;
      currency: string;
      status: string;
      client_secret?: string;
      metadata?: Record<string, string>;
      [key: string]: any;
    };
  };
}

/**
 * Stripe Service
 * Manages Stripe payment operations
 */
export class StripeService {
  private stripeClient: Stripe | null = null;
  private stripeSecretKey: string;
  private stripeWebhookSecret: string;

  constructor() {
    this.stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
    this.stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

    if (!this.stripeSecretKey) {
      console.warn("[Stripe] STRIPE_SECRET_KEY environment variable not set");
    } else {
      this.stripeClient = new Stripe(this.stripeSecretKey);
    }

    if (!this.stripeWebhookSecret) {
      console.warn("[Stripe] STRIPE_WEBHOOK_SECRET environment variable not set");
    }
  }

  /**
   * Create a payment intent for card payment
   */
  async createPaymentIntent(
    request: StripePaymentIntentRequest
  ): Promise<StripePaymentIntentResponse> {
    try {
      if (!this.stripeClient) {
        throw new Error("Stripe client not initialized - STRIPE_SECRET_KEY not configured");
      }

      console.log(
        `[Stripe] Creating payment intent for transaction: ${request.transactionId}`
      );

      const paymentIntent = await this.stripeClient.paymentIntents.create({
        amount: Math.round(request.amount),
        currency: request.currency.toLowerCase(),
        description: request.description,
        metadata: {
          transactionId: request.transactionId,
          externalSystemId: request.externalSystemId,
          externalSystemWebhook: request.externalSystemWebhook,
          ...(request.metadata || {}),
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });

      const response: StripePaymentIntentResponse = {
        clientSecret: paymentIntent.client_secret || "",
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency.toUpperCase(),
        status: this.mapStripeStatus(paymentIntent.status),
        createdAt: new Date(paymentIntent.created * 1000),
      };

      console.log(
        `[Stripe] Payment intent created successfully: ${response.paymentIntentId}`
      );

      return response;
    } catch (error) {
      console.error("[Stripe] Error creating payment intent:", error);

      if (error instanceof Stripe.errors.StripeAPIError) {
        throw new Error(
          `Stripe API Error: ${error.message} (Code: ${error.code})`
        );
      }

      throw new Error(
        `Failed to create Stripe payment intent: ${(error as Error).message}`
      );
    }
  }

  /**
   * Handle Stripe webhook event
   */
  async handleStripeWebhook(event: StripeWebhookEvent): Promise<void> {
    try {
      console.log(`[Stripe] Processing webhook event: ${event.type}`);

      let transactionId = event.data.object.metadata?.transactionId;

      if (!transactionId) {
        const paymentIntentId = event.data.object.id;
        const payment = await db.getPaymentByOperatorReference(paymentIntentId);

        if (!payment) {
          console.warn(
            `[Stripe] Missing transactionId and no payment found for intent: ${paymentIntentId}`
          );
          return;
        }

        transactionId = payment.transactionId;
      }

      switch (event.type) {
        case StripeEventType.PAYMENT_INTENT_SUCCEEDED: {
          console.log(`[Stripe] Payment succeeded for transaction: ${transactionId}`);

          const payment = await db.getPaymentByTransactionId(transactionId);
          if (!payment) {
            console.warn(`[Stripe] Payment not found for transaction: ${transactionId}`);
            return;
          }

          await db.updatePaymentStatus(payment.id, "SUCCESS", {
            stripeEventId: event.id,
            paymentIntentId: event.data.object.id,
            stripeStatus: event.data.object.status,
            amount: event.data.object.amount,
            currency: event.data.object.currency,
          });

          break;
        }

        case StripeEventType.PAYMENT_INTENT_PAYMENT_FAILED: {
          console.log(`[Stripe] Payment failed for transaction: ${transactionId}`);

          const payment = await db.getPaymentByTransactionId(transactionId);
          if (!payment) {
            console.warn(`[Stripe] Payment not found for transaction: ${transactionId}`);
            return;
          }

          await db.updatePaymentStatus(payment.id, "FAILED", {
            stripeEventId: event.id,
            paymentIntentId: event.data.object.id,
            stripeStatus: event.data.object.status,
            lastPaymentError: event.data.object.last_payment_error ?? null,
          });

          break;
        }

        case StripeEventType.PAYMENT_INTENT_CANCELED: {
          console.log(`[Stripe] Payment canceled for transaction: ${transactionId}`);

          const payment = await db.getPaymentByTransactionId(transactionId);
          if (!payment) {
            console.warn(`[Stripe] Payment not found for transaction: ${transactionId}`);
            return;
          }

          await db.updatePaymentStatus(payment.id, "EXPIRED", {
            stripeEventId: event.id,
            paymentIntentId: event.data.object.id,
            stripeStatus: event.data.object.status,
          });

          break;
        }

        case StripeEventType.CHARGE_REFUNDED: {
          console.log(`[Stripe] Charge refunded for transaction: ${transactionId}`);

          const payment = await db.getPaymentByTransactionId(transactionId);
          if (!payment) {
            console.warn(`[Stripe] Payment not found for transaction: ${transactionId}`);
            return;
          }

          await db.updatePaymentStatus(payment.id, payment.status, {
            stripeEventId: event.id,
            paymentIntentId: event.data.object.id,
            stripeStatus: event.data.object.status,
            refunded: true,
          });

          break;
        }

        default:
          console.log(`[Stripe] Unhandled webhook event type: ${event.type}`);
      }

      console.log(
        `[Stripe] Webhook event processed: ${event.type} for transaction ${transactionId}`
      );
    } catch (error) {
      console.error("[Stripe] Error handling webhook:", error);
      throw new Error(
        `Failed to handle Stripe webhook: ${(error as Error).message}`
      );
    }
  }

  /**
   * Verify Stripe webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    try {
      if (!this.stripeWebhookSecret) {
        console.warn("[Stripe] STRIPE_WEBHOOK_SECRET not configured");
        return false;
      }

      const parts = signature.split(",");
      let timestamp = "";
      let signatureValue = "";

      for (const part of parts) {
        if (part.startsWith("t=")) {
          timestamp = part.substring(2);
        } else if (part.startsWith("v1=")) {
          signatureValue = part.substring(3);
        }
      }

      if (!timestamp || !signatureValue) {
        console.warn("[Stripe] Invalid signature format");
        return false;
      }

      const now = Math.floor(Date.now() / 1000);
      const signedTime = parseInt(timestamp);
      const timeDiff = Math.abs(now - signedTime);

      if (timeDiff > 300) {
        console.warn(`[Stripe] Webhook timestamp too old: ${timeDiff} seconds`);
        return false;
      }

      const signedContent = `${timestamp}.${payload}`;
      const expectedSignature = crypto
        .createHmac("sha256", this.stripeWebhookSecret)
        .update(signedContent)
        .digest("hex");

      return crypto.timingSafeEqual(
        Buffer.from(signatureValue),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      console.error("[Stripe] Error verifying webhook signature:", error);
      return false;
    }
  }

  /**
   * Get payment intent status
   */
  async getPaymentIntentStatus(paymentIntentId: string): Promise<string> {
    try {
      if (!this.stripeClient) {
        throw new Error("Stripe client not initialized");
      }

      console.log(`[Stripe] Getting payment intent status: ${paymentIntentId}`);

      const intent = await this.stripeClient.paymentIntents.retrieve(
        paymentIntentId
      );

      return intent.status;
    } catch (error) {
      console.error("[Stripe] Error getting payment intent status:", error);
      throw new Error(
        `Failed to get Stripe payment intent status: ${(error as Error).message}`
      );
    }
  }

  /**
   * Cancel payment intent
   */
  async cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    try {
      if (!this.stripeClient) {
        throw new Error("Stripe client not initialized");
      }

      console.log(`[Stripe] Canceling payment intent: ${paymentIntentId}`);

      await this.stripeClient.paymentIntents.cancel(paymentIntentId);

      console.log(`[Stripe] Payment intent canceled: ${paymentIntentId}`);
    } catch (error) {
      console.error("[Stripe] Error canceling payment intent:", error);
      throw new Error(
        `Failed to cancel Stripe payment intent: ${(error as Error).message}`
      );
    }
  }

  /**
   * Map Stripe payment intent status to our internal format
   */
  private mapStripeStatus(
    stripeStatus: string
  ):
    | "requires_payment_method"
    | "requires_confirmation"
    | "requires_action"
    | "processing"
    | "succeeded"
    | "canceled" {
    switch (stripeStatus) {
      case "requires_payment_method":
        return "requires_payment_method";
      case "requires_confirmation":
        return "requires_confirmation";
      case "requires_action":
        return "requires_action";
      case "processing":
        return "processing";
      case "succeeded":
        return "succeeded";
      case "canceled":
        return "canceled";
      default:
        return "requires_payment_method";
    }
  }
}
