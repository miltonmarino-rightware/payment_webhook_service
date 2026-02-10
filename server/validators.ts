/**
 * LEGAL COMPLIANCE NOTICE
 * 
 * This module implements validation for the Internal Payment Orchestrator.
 * This service does NOT handle, store, or move money.
 * Money flows directly from customer → operator/merchant.
 * This service only orchestrates payment events and maintains audit trails.
 * 
 * All validation must be immutable and non-repudiable.
 */

import { createHmac } from "crypto";
import { z } from "zod";

/**
 * Webhook payload schema for mPesa payments
 */
export const webhookPayloadSchema = z.object({
  transactionId: z.string().min(1).max(64),
  amount: z.number().positive(),
  currency: z.string().length(3).default("MZN"),
  status: z.enum(["SUCCESS", "FAILED", "PENDING"]),
  operatorReference: z.string().min(1).max(128),
  timestamp: z.string().datetime(),
  signature: z.string().min(1),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

/**
 * Validate webhook signature using HMAC-SHA256
 * @param payload - The webhook payload
 * @param signature - The signature from the webhook header
 * @param secret - The shared secret for HMAC validation
 * @returns true if signature is valid, false otherwise
 */
export function validateSignature(
  payload: Record<string, unknown>,
  signature: string,
  secret: string
): boolean {
  // Create a canonical string from payload (excluding signature)
  const { signature: _sig, ...payloadWithoutSignature } = payload;
  const canonical = JSON.stringify(payloadWithoutSignature, Object.keys(payloadWithoutSignature).sort());

  // Calculate expected signature
  const expectedSignature = createHmac("sha256", secret).update(canonical).digest("hex");

  // Compare signatures (constant-time comparison to prevent timing attacks)
  return expectedSignature === signature;
}

/**
 * Valid state transitions for payment lifecycle
 */
const validTransitions: Record<string, string[]> = {
  CREATED: ["PENDING"],
  PENDING: ["SUCCESS", "FAILED", "EXPIRED"],
  SUCCESS: ["COMPLETED"],
  FAILED: ["COMPLETED"],
  EXPIRED: ["COMPLETED"],
  COMPLETED: [], // Terminal state
};

/**
 * Check if a state transition is valid
 * @param fromStatus - Current payment status
 * @param toStatus - Desired payment status
 * @returns true if transition is allowed, false otherwise
 */
export function isValidStateTransition(fromStatus: string, toStatus: string): boolean {
  const allowedTransitions = validTransitions[fromStatus] || [];
  return allowedTransitions.includes(toStatus);
}

/**
 * Validate transaction reference format
 * Expected format: TXN-YYYYMMDD-XXXXX (at least 3 characters after last dash)
 */
export function isValidTransactionId(transactionId: string): boolean {
  const pattern = /^TXN-\d{8}-[A-Z0-9]{3,}$/i;
  return pattern.test(transactionId);
}

/**
 * Check if webhook timestamp is recent (within 5 minutes)
 */
export function isRecentTimestamp(timestamp: string, maxAgeSeconds: number = 300): boolean {
  try {
    const webhookTime = new Date(timestamp).getTime();
    const currentTime = Date.now();
    const ageDifference = currentTime - webhookTime;

    // Allow 5 minutes of clock skew in either direction
    return Math.abs(ageDifference) <= maxAgeSeconds * 1000;
  } catch {
    return false;
  }
}

/**
 * Validate webhook payload structure and content
 */
export async function validateWebhookPayload(
  payload: unknown
): Promise<{ valid: boolean; error?: string; data?: WebhookPayload }> {
  try {
    const data = webhookPayloadSchema.parse(payload);

    // Additional validations
    if (!isValidTransactionId(data.transactionId)) {
      return {
        valid: false,
        error: "Invalid transaction ID format. Expected: TXN-YYYYMMDD-XXXXX",
      };
    }

    if (!isRecentTimestamp(data.timestamp)) {
      return {
        valid: false,
        error: "Webhook timestamp is too old or in the future",
      };
    }

    return { valid: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0];
      return {
        valid: false,
        error: `Validation error: ${firstError?.message || "Unknown error"}`,
      };
    }
    return {
      valid: false,
      error: "Failed to validate webhook payload",
    };
  }
}

/**
 * Calculate next retry time with exponential backoff
 * Retry schedule: 5s, 30s, 2m, 10m, 1h
 */
export function calculateNextRetryTime(attemptCount: number): Date {
  const retryDelays = [5, 30, 120, 600, 3600]; // seconds
  const delayIndex = Math.min(attemptCount, retryDelays.length - 1);
  const delaySeconds = retryDelays[delayIndex];

  const nextRetry = new Date();
  nextRetry.setSeconds(nextRetry.getSeconds() + delaySeconds);
  return nextRetry;
}

/**
 * Check if notification should be retried
 */
export function shouldRetryNotification(attemptCount: number): boolean {
  const maxAttempts = 5;
  return attemptCount < maxAttempts;
}
