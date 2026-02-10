/**
 * LEGAL COMPLIANCE NOTICE
 *
 * This module handles payment request endpoints for the Internal Payment Orchestrator.
 * This service does NOT handle, store, or move money.
 * Money flows directly from customer → operator/merchant.
 * This service only initiates payment intents via STK Push.
 *
 * All payment requests must be:
 * - Validated and authenticated (internal systems only)
 * - Logged immutably for audit
 * - Idempotent (safe to retry)
 * - Non-repudiable (signature-based)
 */

import { Router, Request, Response } from "express";
import * as db from "./db";
import * as paymentValidators from "./operators/mpesa/paymentRequest.validators";
import * as mpesaOutbound from "./operators/mpesa/mpesaOutbound.service";

const router = Router();

/**
 * POST /payments/mpesa/request
 *
 * Initiate a payment via mPesa STK Push
 *
 * This endpoint is for INTERNAL USE ONLY.
 * It creates a payment intent and sends an STK Push request to mPesa.
 *
 * Request body:
 * {
 *   "transactionId": "TXN-20250210-002",
 *   "externalSystemId": "restaurant-pos-001",
 *   "externalSystemWebhook": "https://internal-restaurant-api/webhooks/payment",
 *   "amount": 500.00,
 *   "currency": "MZN",
 *   "phoneNumber": "25884xxxxxxx",
 *   "description": "Order #1234"
 * }
 *
 * Response (200 OK):
 * {
 *   "success": true,
 *   "transactionId": "TXN-20250210-002",
 *   "status": "PENDING",
 *   "message": "STK Push sent to customer"
 * }
 */
router.post("/mpesa/request", async (req: Request, res: Response) => {
  try {
    const ipAddress = req.ip || "unknown";

    // Validate payment request payload
    const validationResult = await paymentValidators.validatePaymentRequest(req.body);

    if (!validationResult.valid) {
      console.warn(
        `[Payments] Invalid payment request from ${ipAddress}: ${validationResult.error}`
      );

      return res.status(400).json({
        success: false,
        error: validationResult.error,
      });
    }

    const paymentRequest = validationResult.data!;

    // Check for duplicate transaction
    const existingPayment = await db.getPaymentByTransactionId(
      paymentRequest.transactionId
    );

    if (existingPayment) {
      // Idempotent response: return existing payment status
      console.log(
        `[Payments] Duplicate payment request for ${paymentRequest.transactionId}, returning existing status`
      );

      return res.status(200).json({
        success: true,
        transactionId: paymentRequest.transactionId,
        status: existingPayment.status,
        message: "Payment already exists",
      });
    }

    // Create initial payment record in CREATED state
    const payment = await db.createPayment({
      transactionId: paymentRequest.transactionId,
      externalSystemId: paymentRequest.externalSystemId,
      amount: String(paymentRequest.amount),
      currency: paymentRequest.currency,
      status: "CREATED",
      ipAddress,
    });

    // Log payment intent creation
    await db.logTransaction({
      paymentId: payment.id,
      eventType: "PAYMENT_INTENT_CREATED",
      details: {
        transactionId: paymentRequest.transactionId,
        amount: paymentRequest.amount,
        currency: paymentRequest.currency,
        phoneNumber: paymentValidators.normalizePhoneNumber(
          paymentRequest.phoneNumber
        ),
        description: paymentRequest.description,
        externalSystemId: paymentRequest.externalSystemId,
      },
      ipAddress,
    });

    // Send STK Push request to mPesa
    const stkPushResponse = await mpesaOutbound.sendStkPushRequest({
      transactionId: paymentRequest.transactionId,
      phoneNumber: paymentRequest.phoneNumber,
      amount: paymentRequest.amount,
      currency: paymentRequest.currency,
      description: paymentRequest.description,
      externalSystemId: paymentRequest.externalSystemId,
    });

    if (stkPushResponse.success) {
      // Update payment state to PENDING
      await db.updatePaymentStatus(payment.id, "PENDING");

    // Log STK Push sent event
    await db.logTransaction({
      paymentId: payment.id,
      eventType: "STK_PUSH_SENT",
      details: JSON.stringify({
        operatorReference: stkPushResponse.operatorReference,
        checkoutRequestId: stkPushResponse.checkoutRequestId,
        responseCode: stkPushResponse.responseCode,
        responseMessage: stkPushResponse.responseMessage,
      }),
      ipAddress,
    });

      console.log(
        `[Payments] STK Push sent successfully for transaction ${paymentRequest.transactionId}`
      );

      return res.status(200).json({
        success: true,
        transactionId: paymentRequest.transactionId,
        status: "PENDING",
        message: "STK Push sent to customer",
        operatorReference: stkPushResponse.operatorReference,
      });
    } else {
      // STK Push request failed
      await db.logTransaction({
        paymentId: payment.id,
        eventType: "STK_PUSH_FAILED",
        details: JSON.stringify({
          responseCode: stkPushResponse.responseCode,
          responseMessage: stkPushResponse.responseMessage,
          error: stkPushResponse.error,
        }),
        ipAddress,
      });

      console.error(
        `[Payments] STK Push failed for transaction ${paymentRequest.transactionId}: ${stkPushResponse.error}`
      );

      return res.status(400).json({
        success: false,
        transactionId: paymentRequest.transactionId,
        error: stkPushResponse.error || "Failed to send STK Push",
        message: "STK Push request failed",
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    console.error(`[Payments] Error processing payment request: ${errorMessage}`);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /payments/:transactionId
 *
 * Get payment status (internal use only)
 *
 * Returns current payment status and history.
 */
router.get("/:transactionId", async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;

    // Validate transaction ID format
    if (!/^TXN-\d{8}-[A-Z0-9]{3,}$/i.test(transactionId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid transaction ID format",
      });
    }

    // Get payment
    const payment = await db.getPaymentByTransactionId(transactionId);

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: "Payment not found",
      });
    }

    // Get transaction logs
    const logs = await db.getTransactionLogs(payment.id);

    return res.status(200).json({
      success: true,
      payment: {
        id: payment.id,
        transactionId: payment.transactionId,
        externalSystemId: payment.externalSystemId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        createdAt: payment.createdAt,
        completedAt: payment.completedAt,
      },
      logs: logs.map((log) => ({
        eventType: log.eventType,
        details: log.details,
        createdAt: log.createdAt,
      })),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    console.error(`[Payments] Error retrieving payment: ${errorMessage}`);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

export default router;
