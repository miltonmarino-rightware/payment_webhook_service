/**
 * LEGAL COMPLIANCE NOTICE
 * 
 * This module handles external system notifications for the Internal Payment Orchestrator.
 * This service does NOT handle, store, or move money.
 * Money flows directly from customer → operator/merchant.
 * This service only notifies internal systems of payment outcomes.
 * 
 * All notifications must be:
 * - Cryptographically signed (HMAC-SHA256)
 * - Idempotent (safe to retry)
 * - Logged for audit trail
 * - Non-repudiable (signature-based)
 */

import axios from "axios";
import * as db from "./db";
import * as validators from "./validators";
import { createHmac } from "crypto";

/**
 * Send notification to external system about payment status
 */
export async function notifyExternalSystem(paymentId: number): Promise<boolean> {
  try {
    const payment = await db.getPaymentById(paymentId);
    if (!payment) {
      console.error(`[Notification] Payment ${paymentId} not found`);
      return false;
    }

    const notification = await db.getNotificationByPaymentId(paymentId);
    if (!notification) {
      console.error(`[Notification] No notification record for payment ${paymentId}`);
      return false;
    }

    // Build notification payload
    const payload = {
      event: `payment.${payment.status.toLowerCase()}`,
      paymentId: payment.id,
      transactionId: payment.transactionId,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      externalSystemId: payment.externalSystemId,
      timestamp: new Date().toISOString(),
    };

    // Sign payload
    const secret = process.env.NOTIFICATION_SECRET || "default-secret";
    const signature = createHmac("sha256", secret)
      .update(JSON.stringify(payload))
      .digest("hex");

    const payloadWithSignature = {
      ...payload,
      signature,
    };

    // Send notification
    try {
      const response = await axios.post(notification.externalSystemWebhook, payloadWithSignature, {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
        },
      });

      // Update notification status
      await db.updateNotificationStatus(
        notification.id,
        "SENT",
        response.status,
        JSON.stringify(response.data)
      );

      // Log successful notification
      await db.logTransaction({
        paymentId: payment.id,
        eventType: "NOTIFICATION_SENT",
        details: {
          externalSystemWebhook: notification.externalSystemWebhook,
          responseStatus: response.status,
        },
      });

      console.log(`[Notification] Successfully notified external system for payment ${paymentId}`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const responseStatus = axios.isAxiosError(error) ? error.response?.status : undefined;

      // Update notification status to failed
      await db.updateNotificationStatus(
        notification.id,
        "FAILED",
        responseStatus,
        errorMessage
      );

      // Check if we should retry
      const shouldRetry = validators.shouldRetryNotification(notification.attemptCount);
      if (shouldRetry) {
        const nextRetryTime = validators.calculateNextRetryTime(notification.attemptCount);
        await db.incrementNotificationAttempt(notification.id, nextRetryTime);

        console.log(
          `[Notification] Failed to notify external system for payment ${paymentId}, will retry at ${nextRetryTime}`
        );
      } else {
        console.error(
          `[Notification] Max retry attempts reached for payment ${paymentId}, giving up`
        );

        // Log final failure
        await db.logTransaction({
          paymentId: payment.id,
          eventType: "NOTIFICATION_FAILED",
          details: {
            externalSystemWebhook: notification.externalSystemWebhook,
            error: errorMessage,
            attemptCount: notification.attemptCount,
          },
        });
      }

      return false;
    }
  } catch (error) {
    console.error(`[Notification] Error notifying external system for payment ${paymentId}:`, error);
    return false;
  }
}

/**
 * Process pending notifications and retry failed ones
 * This should be called periodically (e.g., every minute)
 */
export async function processPendingNotifications(): Promise<void> {
  try {
    const pendingNotifications = await db.getPendingNotifications();

    for (const notification of pendingNotifications) {
      // Check if it's time to retry
      if (notification.nextRetryAt && new Date() < notification.nextRetryAt) {
        continue; // Not yet time to retry
      }

      await notifyExternalSystem(notification.paymentId);
    }
  } catch (error) {
    console.error("[Notification] Error processing pending notifications:", error);
  }
}

/**
 * Start periodic notification processor
 */
export function startNotificationProcessor(intervalMs: number = 60000): ReturnType<typeof setInterval> {
  console.log("[Notification] Starting notification processor");
  return setInterval(processPendingNotifications, intervalMs);
}
