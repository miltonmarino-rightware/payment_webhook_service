/**
 * Stripe Payment Routes
 * 
 * Routes for Stripe payment operations:
 * - POST /payments/stripe/request - Initiate card payment
 * - POST /webhooks/stripe - Handle Stripe webhook events
 * 
 * These routes are isolated from mPesa and other operators.
 * Security/compliance middleware is applied at the server level.
 */

import { Router, Request, Response } from "express";
import { StripeService } from "../operators/stripe/stripe.service";
import {
  validateStripePaymentRequest,
  validateStripeWebhookEvent,
  validateStripeWebhookSignature,
} from "../operators/stripe/stripe.validators";

export function createStripeRouter(): Router {
  const router = Router();
  const stripeService = new StripeService();

  /**
   * POST /payments/stripe/request
   * Initiate a Stripe card payment
   * 
   * Request body:
   * {
   *   "transactionId": "TXN-20250304-XXXXX",
   *   "externalSystemId": "restaurant-pos-001",
   *   "externalSystemWebhook": "https://internal-restaurant-api/webhooks/payment",
   *   "amount": 5000,  // in cents
   *   "currency": "USD",
   *   "description": "Order #1234",
   *   "customerEmail": "customer@example.com"
   * }
   * 
   * Response:
   * {
   *   "clientSecret": "pi_...",
   *   "paymentIntentId": "pi_...",
   *   "amount": 5000,
   *   "currency": "USD",
   *   "status": "requires_payment_method",
   *   "createdAt": "2025-03-04T00:00:00Z"
   * }
   */
  router.post("/payments/stripe/request", async (req: Request, res: Response) => {
    try {
      console.log("[StripeRoutes] POST /payments/stripe/request");

      // Validate request payload
      const validation = validateStripePaymentRequest(req.body);
      if (!validation.valid) {
        console.warn(`[StripeRoutes] Invalid payment request: ${validation.error}`);
        return res.status(400).json({
          error: "Invalid payment request",
          details: validation.error,
        });
      }

      // TODO: Implement full flow
      // 1. Create payment intent via StripeService
      // 2. Log audit event: PAYMENT_REQUEST_RECEIVED
      // 3. Create payment record in database
      // 4. Log audit event: PAYMENT_INTENT_CREATED
      // 5. Return response with client secret

      // Placeholder response
      const response = {
        clientSecret: "pi_test_secret_placeholder",
        paymentIntentId: "pi_test_placeholder",
        amount: validation.data?.amount,
        currency: validation.data?.currency,
        status: "requires_payment_method",
        createdAt: new Date().toISOString(),
      };

      console.log(
        `[StripeRoutes] Payment intent created: ${response.paymentIntentId}`
      );

      res.status(201).json(response);
    } catch (error) {
      console.error("[StripeRoutes] Error processing payment request:", error);
      res.status(500).json({
        error: "Failed to process payment request",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /webhooks/stripe
   * Handle Stripe webhook events
   * 
   * Stripe sends webhook events with signature verification.
   * Header: stripe-signature
   * 
   * Event types handled:
   * - payment_intent.succeeded
   * - payment_intent.payment_failed
   * - payment_intent.canceled
   * - charge.refunded
   */
  router.post("/webhooks/stripe", async (req: Request, res: Response) => {
    try {
      console.log("[StripeRoutes] POST /webhooks/stripe");

      // Get signature from header
      const signature = req.headers["stripe-signature"];
      if (!signature) {
        console.warn("[StripeRoutes] Missing stripe-signature header");
        return res.status(400).json({
          error: "Missing stripe-signature header",
        });
      }

      // Validate signature
      const signatureValidation = validateStripeWebhookSignature(signature);
      if (!signatureValidation.valid) {
        console.warn(
          `[StripeRoutes] Invalid signature: ${signatureValidation.error}`
        );
        return res.status(401).json({
          error: "Invalid signature",
        });
      }

      // TODO: Implement signature verification with Stripe webhook secret
      // const isValid = stripeService.verifyWebhookSignature(
      //   JSON.stringify(req.body),
      //   signatureValidation.signature!
      // );
      // if (!isValid) {
      //   return res.status(401).json({ error: "Signature verification failed" });
      // }

      // Validate webhook event
      const eventValidation = validateStripeWebhookEvent(req.body);
      if (!eventValidation.valid) {
        console.warn(`[StripeRoutes] Invalid webhook event: ${eventValidation.error}`);
        return res.status(400).json({
          error: "Invalid webhook event",
          details: eventValidation.error,
        });
      }

      // TODO: Implement full flow
      // 1. Log audit event: WEBHOOK_RECEIVED
      // 2. Call stripeService.handleStripeWebhook()
      // 3. Update payment state based on event type
      // 4. Log audit event: WEBHOOK_PROCESSED
      // 5. Trigger notification to external system

      console.log(
        `[StripeRoutes] Webhook event processed: ${eventValidation.data?.type}`
      );

      // Return 200 OK to acknowledge receipt
      res.status(200).json({ received: true });
    } catch (error) {
      console.error("[StripeRoutes] Error processing webhook:", error);
      res.status(500).json({
        error: "Failed to process webhook",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return router;
}
