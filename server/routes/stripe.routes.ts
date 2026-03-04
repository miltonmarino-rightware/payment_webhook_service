/**
 * Stripe Payment Routes
 * 
 * Routes for Stripe payment operations:
 * - POST /payments/stripe/request - Initiate card payment
 * - POST /webhooks/stripe - Handle Stripe webhook events
 * 
 * These routes are isolated from mPesa and other operators.
 * Security/compliance middleware is applied at the server level.
 * 
 * LEGAL COMPLIANCE NOTICE:
 * This service does NOT handle, store, or move money.
 * Money flows directly from customer → Stripe → merchant.
 * This service only orchestrates payment intents and maintains audit trails.
 */

import { Router, Request, Response } from "express";
import { StripeService, StripeEventType } from "../operators/stripe/stripe.service";
import {
  validateStripePaymentRequest,
  validateStripeWebhookEvent,
  validateStripeWebhookSignature,
} from "../operators/stripe/stripe.validators";
import { internalAuthMiddleware, requireInternalAuth } from "../compliance/internalAuth.middleware";
import * as db from "../db";
import { maskSecret } from "../compliance/masking.service";
import { AuditTrailService } from "../compliance/auditTrail.service";
import { AuditEventType } from "../compliance/auditTrail.service";

// Global audit trail service instance
let auditTrailService: AuditTrailService | null = null;

/**
 * Set the audit trail service instance
 * Called from server core during initialization
 */
export function setStripeAuditTrailService(service: AuditTrailService) {
  auditTrailService = service;
}

export function createStripeRouter(): Router {
  const router = Router();
  const stripeService = new StripeService();

  /**
   * POST /payments/stripe/request
   * Initiate a Stripe card payment
   * 
   * Authentication: Internal API key required (X-Internal-API-Key header)
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
   * Response (201 Created):
   * {
   *   "success": true,
   *   "transactionId": "TXN-20250304-XXXXX",
   *   "status": "PENDING",
   *   "operator": "stripe",
   *   "paymentIntentId": "pi_...",
   *   "clientSecret": "pi_..._secret_...",
   *   "createdAt": "2025-03-04T00:00:00Z"
   * }
   */
  router.post(
    "/payments/stripe/request",
    internalAuthMiddleware(),
    requireInternalAuth,
    async (req: Request, res: Response) => {
      const correlationId = (req as any).correlationId || "unknown";
      const ipAddress = req.ip || "unknown";

      try {
        console.log(
          `[StripeRoutes] POST /payments/stripe/request - Correlation ID: ${correlationId}`
        );

        // Validate request payload
        const validation = validateStripePaymentRequest(req.body);
        if (!validation.valid) {
          console.warn(
            `[StripeRoutes] Invalid payment request: ${validation.error}`
          );

        // Log audit event for invalid request
        if (auditTrailService) {
          await auditTrailService.logEvent(
            AuditEventType.WEBHOOK_RECEIVED,
            correlationId,
            {
              ip: ipAddress,
              systemId: req.body?.externalSystemId,
              endpoint: "/payments/stripe/request",
              validationError: validation.error,
            }
          );
        }

          return res.status(400).json({
            error: "Invalid payment request",
            details: validation.error,
          });
        }

        const paymentRequest = validation.data!;

        // Log audit event: Payment request received
        if (auditTrailService) {
          await auditTrailService.logEvent(
            AuditEventType.WEBHOOK_RECEIVED,
            correlationId,
            {
              ip: ipAddress,
              systemId: paymentRequest.externalSystemId,
              endpoint: "/payments/stripe/request",
              transactionId: paymentRequest.transactionId,
              amount: paymentRequest.amount,
              currency: paymentRequest.currency,
            }
          );
        }

        // Check for idempotency: if transaction already exists, return existing or controlled conflict
        let existingPayment = await db.getPaymentByTransactionId(
          paymentRequest.transactionId
        );

        if (existingPayment) {
          console.log(
            `[StripeRoutes] Idempotent request: transaction ${paymentRequest.transactionId} already exists`
          );

          // If payment is already completed, return 409 Conflict
          if (["SUCCESS", "FAILED", "EXPIRED", "COMPLETED"].includes(existingPayment.status)) {
            return res.status(409).json({
              error: "Payment already processed",
              transactionId: existingPayment.transactionId,
              status: existingPayment.status,
            });
          }

          // If payment is still pending, return existing response
          if (existingPayment.status === "PENDING") {
            const clientSecretValue = (existingPayment.operatorResponse as any)?.clientSecret;
            const existingResponse = {
              success: true,
              transactionId: existingPayment.transactionId,
              status: existingPayment.status,
              operator: "stripe",
              paymentIntentId: existingPayment.operatorReference || "",
              clientSecret: clientSecretValue
                ? maskSecret(String(clientSecretValue))
                : undefined,
              createdAt: existingPayment.createdAt.toISOString(),
            };

            console.log(
              `[StripeRoutes] Returning existing payment intent: ${existingPayment.operatorReference}`
            );

            return res.status(200).json(existingResponse);
          }
        }

        // Create payment record in database with CREATED status
        const newPayment = await db.createPayment({
          transactionId: paymentRequest.transactionId,
          status: "CREATED",
          externalSystemId: paymentRequest.externalSystemId,
          amount: String(paymentRequest.amount),
          currency: paymentRequest.currency,
          operatorResponse: null,
        });

        console.log(
          `[StripeRoutes] Created payment record: ${newPayment.id} - Transaction: ${paymentRequest.transactionId}`
        );

        // Call Stripe API to create PaymentIntent
        let stripeResponse;
        try {
          stripeResponse = await stripeService.createPaymentIntent(paymentRequest);
        } catch (stripeError) {
          console.error("[StripeRoutes] Stripe API error:", stripeError);

          // Update payment status to FAILED
          await db.updatePaymentStatus(newPayment.id, "FAILED", {
            error: (stripeError as Error).message,
          });

          // Log audit event for payment intent creation failure
          if (auditTrailService) {
            await auditTrailService.logEvent(
              AuditEventType.WEBHOOK_RECEIVED,
              correlationId,
              {
                ip: ipAddress,
                systemId: paymentRequest.externalSystemId,
                endpoint: "/payments/stripe/request",
                transactionId: paymentRequest.transactionId,
                error: (stripeError as Error).message,
              }
            );
          }

          return res.status(502).json({
            error: "Failed to create payment intent with Stripe",
            message: (stripeError as Error).message,
          });
        }

        // Update payment status to PENDING and store operator reference
        const updatedPayment = await db.updatePaymentStatus(
          newPayment.id,
          "PENDING",
          {
            clientSecret: stripeResponse.clientSecret,
            paymentIntentId: stripeResponse.paymentIntentId,
            status: stripeResponse.status,
          }
        );

        console.log(
          `[StripeRoutes] Payment intent created: ${stripeResponse.paymentIntentId}`
        );

        // Log audit event: Payment intent created successfully
        if (auditTrailService) {
          await auditTrailService.logEvent(
            AuditEventType.WEBHOOK_RECEIVED,
            correlationId,
            {
              ip: ipAddress,
              systemId: paymentRequest.externalSystemId,
              endpoint: "/payments/stripe/request",
              transactionId: paymentRequest.transactionId,
              paymentIntentId: stripeResponse.paymentIntentId,
              status: stripeResponse.status,
            }
          );
        }

        // Return response with client secret (masked in logs)
        const response = {
          success: true,
          transactionId: paymentRequest.transactionId,
          status: updatedPayment.status,
          operator: "stripe",
          paymentIntentId: stripeResponse.paymentIntentId,
          clientSecret: stripeResponse.clientSecret, // Frontend will use this
          createdAt: updatedPayment.createdAt.toISOString(),
        };

        // Log response (with masking)
        console.log(
          `[StripeRoutes] Payment request successful - Transaction: ${paymentRequest.transactionId}, Intent: ${stripeResponse.paymentIntentId}`
        );

        res.status(201).json(response);
      } catch (error) {
        console.error("[StripeRoutes] Error processing webhook:", error);

        // Log audit event for error
        if (auditTrailService) {
          await auditTrailService.logEvent(
            AuditEventType.WEBHOOK_RECEIVED,
            correlationId,
            {
              ip: ipAddress,
              endpoint: "/webhooks/stripe",
              error: (error as Error).message,
            }
          );
        }

        res.status(500).json({
          error: "Failed to process webhook",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

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
    const correlationId = (req as any).correlationId || "unknown";
    const ipAddress = req.ip || "unknown";

    try {
      console.log(
        `[StripeRoutes] POST /webhooks/stripe - Correlation ID: ${correlationId}`
      );

      // Get signature from header
      const signature = req.headers["stripe-signature"];
      if (!signature) {
        console.warn("[StripeRoutes] Missing stripe-signature header");

        // Log audit event
        if (auditTrailService) {
          await auditTrailService.logEvent(
            AuditEventType.SIGNATURE_INVALID,
            correlationId,
            {
              ip: ipAddress,
              endpoint: "/webhooks/stripe",
              reason: "Missing stripe-signature header",
            }
          );
        }

        return res.status(400).json({
          error: "Missing stripe-signature header",
        });
      }

      // Validate signature format
      const signatureValidation = validateStripeWebhookSignature(signature);
      if (!signatureValidation.valid) {
        console.warn(
          `[StripeRoutes] Invalid signature format: ${signatureValidation.error}`
        );

        // Log audit event
        if (auditTrailService) {
          await auditTrailService.logEvent(
            AuditEventType.SIGNATURE_INVALID,
            correlationId,
            {
              ip: ipAddress,
              endpoint: "/webhooks/stripe",
              reason: signatureValidation.error,
            }
          );
        }

        return res.status(401).json({
          error: "Invalid signature format",
        });
      }

      // Verify webhook signature with Stripe
      const rawBody = JSON.stringify(req.body);
      const isSignatureValid = stripeService.verifyWebhookSignature(
        rawBody,
        signatureValidation.signature!
      );

      if (!isSignatureValid) {
        console.warn("[StripeRoutes] Stripe webhook signature verification failed");

        // Log audit event
        if (auditTrailService) {
          await auditTrailService.logEvent(
            AuditEventType.SIGNATURE_INVALID,
            correlationId,
            {
              ip: ipAddress,
              endpoint: "/webhooks/stripe",
              reason: "Signature verification failed",
            }
          );
        }

        return res.status(401).json({
          error: "Signature verification failed",
        });
      }

      // Log successful signature verification
      if (auditTrailService) {
        await auditTrailService.logEvent(
          AuditEventType.SIGNATURE_VALID,
          correlationId,
          {
            ip: ipAddress,
            endpoint: "/webhooks/stripe",
            webhookEventType: req.body?.type,
          }
        );
      }

      // Validate webhook event
      const eventValidation = validateStripeWebhookEvent(req.body);
      if (!eventValidation.valid) {
        console.warn(
          `[StripeRoutes] Invalid webhook event: ${eventValidation.error}`
        );

        return res.status(400).json({
          error: "Invalid webhook event",
          details: eventValidation.error,
        });
      }

      const event = eventValidation.data!;

      // Convert validated event to service interface
      // Map string type to StripeEventType enum
      const typeMap: Record<string, StripeEventType> = {
        "payment_intent.created": StripeEventType.PAYMENT_INTENT_CREATED,
        "payment_intent.succeeded": StripeEventType.PAYMENT_INTENT_SUCCEEDED,
        "payment_intent.payment_failed": StripeEventType.PAYMENT_INTENT_PAYMENT_FAILED,
        "payment_intent.canceled": StripeEventType.PAYMENT_INTENT_CANCELED,
        "charge.refunded": StripeEventType.CHARGE_REFUNDED,
      };

      const serviceEvent = {
        id: event.id,
        type: typeMap[event.type] || StripeEventType.PAYMENT_INTENT_CREATED,
        created: event.created,
        data: event.data,
      };

      // Handle webhook event
      await stripeService.handleStripeWebhook(serviceEvent);

      console.log(
        `[StripeRoutes] Webhook event processed: ${event.type}`
      );

      // Return 200 OK to acknowledge receipt
      res.status(200).json({ received: true });
    } catch (error) {
      console.error("[StripeRoutes] Error processing webhook:", error);

      // Log audit event for error
      if (auditTrailService) {
        await auditTrailService.logEvent(
          AuditEventType.WEBHOOK_RECEIVED,
          correlationId,
          {
            ip: ipAddress,
            endpoint: "/webhooks/stripe",
            error: (error as Error).message,
          }
        );
      }

      res.status(500).json({
        error: "Failed to process webhook",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return router;
}
