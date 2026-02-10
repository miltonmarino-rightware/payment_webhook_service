/**
 * LEGAL COMPLIANCE NOTICE
 * 
 * This module handles webhook reception for the Internal Payment Orchestrator.
 * This service does NOT handle, store, or move money.
 * Money flows directly from customer → operator/merchant.
 * This service only orchestrates payment events and maintains audit trails.
 * 
 * All webhooks must be:
 * - Cryptographically verified (HMAC-SHA256)
 * - Logged immutably for audit
 * - Idempotent (safe to retry)
 * - Non-repudiable (signature-based)
 */

import { Router, Request, Response } from "express";
import * as db from "./db";
import * as validators from "./validators";
import { notifyExternalSystem } from "./notifications";

const router = Router();

/**
 * POST /webhooks/mpesa
 * Receives payment events from mPesa operator
 */
router.post("/mpesa", async (req: Request, res: Response) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress || "unknown";
    const userAgent = req.get("user-agent") || "unknown";

    // Validate webhook payload
    const validation = await validators.validateWebhookPayload(req.body);
    if (!validation.valid) {
      await db.logTransaction({
        paymentId: 0, // Will be updated after payment is found
        eventType: "WEBHOOK_VALIDATION_FAILED",
        details: {
          error: validation.error,
          receivedPayload: req.body,
        },
        ipAddress,
        userAgent,
      });

      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    const payload = validation.data!;

    // Verify signature (using environment variable or default)
    const webhookSecret = process.env.MPESA_WEBHOOK_SECRET || "default-secret";
    if (!validators.validateSignature(req.body, payload.signature, webhookSecret)) {
      await db.logTransaction({
        paymentId: 0,
        eventType: "SIGNATURE_VALIDATION_FAILED",
        details: {
          transactionId: payload.transactionId,
          receivedSignature: payload.signature,
        },
        ipAddress,
        userAgent,
      });

      return res.status(401).json({
        success: false,
        error: "Invalid webhook signature",
      });
    }

    // Check if payment already exists
    let payment = await db.getPaymentByTransactionId(payload.transactionId);

    if (payment) {
      // Idempotent response - payment already processed
      await db.logTransaction({
        paymentId: payment.id,
        eventType: "DUPLICATE_WEBHOOK",
        details: {
          previousStatus: payment.status,
          incomingStatus: payload.status,
        },
        ipAddress,
        userAgent,
      });

      return res.status(200).json({
        success: true,
        transactionId: payload.transactionId,
        status: payment.status,
        message: "Payment already processed",
      });
    }

    // Create new payment record
    payment = await db.createPayment({
      transactionId: payload.transactionId,
      operatorReference: payload.operatorReference,
      externalSystemId: req.body.externalSystemId || "unknown",
      amount: String(payload.amount),
      currency: payload.currency,
      status: "CREATED",
      operatorResponse: req.body,
      ipAddress,
      userAgent,
    });

    // Log webhook received event
    await db.logTransaction({
      paymentId: payment.id,
      eventType: "WEBHOOK_RECEIVED",
      details: {
        operatorStatus: payload.status,
        operatorReference: payload.operatorReference,
      },
      ipAddress,
      userAgent,
    });

    // Transition to PENDING state
    payment = await db.updatePaymentStatus(payment.id, "PENDING", req.body);

    await db.logTransaction({
      paymentId: payment.id,
      eventType: "STATE_CHANGED",
      details: {
        fromStatus: "CREATED",
        toStatus: "PENDING",
      },
      ipAddress,
      userAgent,
    });

    // Process operator status and update payment state
    let finalStatus = "PENDING";
    if (payload.status === "SUCCESS") {
      finalStatus = "SUCCESS";
      payment = await db.updatePaymentStatus(payment.id, "SUCCESS", req.body);

      await db.logTransaction({
        paymentId: payment.id,
        eventType: "STATE_CHANGED",
        details: {
          fromStatus: "PENDING",
          toStatus: "SUCCESS",
        },
        ipAddress,
        userAgent,
      });
    } else if (payload.status === "FAILED") {
      finalStatus = "FAILED";
      payment = await db.updatePaymentStatus(payment.id, "FAILED", req.body);

      await db.logTransaction({
        paymentId: payment.id,
        eventType: "STATE_CHANGED",
        details: {
          fromStatus: "PENDING",
          toStatus: "FAILED",
        },
        ipAddress,
        userAgent,
      });
    }

    // Create notification for external system if payment is completed
    if (["SUCCESS", "FAILED"].includes(finalStatus)) {
      const externalWebhook = req.body.externalSystemWebhook;
      if (externalWebhook) {
        await db.createNotification({
          paymentId: payment.id,
          externalSystemWebhook: externalWebhook,
          status: "PENDING",
        });

        // Attempt to send notification immediately
        await notifyExternalSystem(payment.id);
      }
    }

    return res.status(200).json({
      success: true,
      transactionId: payload.transactionId,
      status: finalStatus,
    });
  } catch (error) {
    console.error("[Webhook] Error processing mPesa webhook:", error);

    await db.logTransaction({
      paymentId: 0,
      eventType: "WEBHOOK_ERROR",
      details: {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      ipAddress: req.ip || "unknown",
      userAgent: req.get("user-agent") || "unknown",
    });

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /webhooks/health
 * Health check endpoint
 */
router.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

export default router;
