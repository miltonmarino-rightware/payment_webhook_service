/**
 * LEGAL COMPLIANCE NOTICE
 *
 * This module validates payment requests for STK Push initiation.
 * This service does NOT handle, store, or move money.
 * Money flows directly from customer → operator/merchant.
 * This service only validates payment intent requests.
 *
 * All validation must be immutable and non-repudiable.
 */

import { z } from "zod";

/**
 * Schema for payment request payload
 *
 * Validates that payment request contains all required fields
 * and that values are within acceptable ranges.
 */
export const paymentRequestSchema = z.object({
  transactionId: z
    .string()
    .regex(/^TXN-\d{8}-[A-Z0-9]{3,}$/i, "Invalid transaction ID format (TXN-YYYYMMDD-XXXXX)"),
  externalSystemId: z
    .string()
    .min(1, "External system ID is required")
    .max(128, "External system ID too long"),
  externalSystemWebhook: z
    .string()
    .url("Invalid webhook URL")
    .refine((url) => url.startsWith("https://"), "Webhook must use HTTPS"),
  amount: z
    .number()
    .positive("Amount must be positive")
    .max(999999.99, "Amount exceeds maximum allowed"),
  currency: z
    .string()
    .length(3, "Currency must be 3-letter code")
    .default("MZN"),
  phoneNumber: z
    .string()
    .regex(/^(\+258|258)8[0-9]{8}$|^0?8[0-9]{8}$/, "Invalid Mozambique phone number"),
  description: z
    .string()
    .min(1, "Description is required")
    .max(255, "Description too long"),
});

export type PaymentRequest = z.infer<typeof paymentRequestSchema>;

/**
 * Validate payment request payload
 *
 * Returns validation result with data or error message.
 */
export async function validatePaymentRequest(
  payload: unknown
): Promise<{
  valid: boolean;
  data?: PaymentRequest;
  error?: string;
}> {
  try {
    const data = await paymentRequestSchema.parseAsync(payload);
    return { valid: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`);
      return {
        valid: false,
        error: messages.join("; "),
      };
    }
    return {
      valid: false,
      error: "Validation error",
    };
  }
}

/**
 * Check if transaction ID already exists
 *
 * Prevents duplicate payment requests for same transaction.
 */
export function isDuplicateTransaction(
  existingTransactionId: string | null,
  newTransactionId: string
): boolean {
  return existingTransactionId === newTransactionId;
}

/**
 * Validate phone number format
 *
 * Ensures phone number is valid Mozambique format.
 */
export function isValidPhoneNumber(phoneNumber: string): boolean {
  // Accept: 258843456789 (12 digits), +258843456789, 0843456789 (10 digits), 843456789 (9 digits)
  // Mozambique mobile numbers start with 8 and have 9 digits total
  const pattern = /^(\+258|258)8[0-9]{8}$|^0?8[0-9]{8}$/;
  return pattern.test(phoneNumber);
}

/**
 * Normalize phone number to mPesa format
 *
 * Converts various formats to standard: 258xxxxxxxxx
 */
export function normalizePhoneNumber(phoneNumber: string): string {
  // Remove + and spaces
  let normalized = phoneNumber.replace(/[^\d]/g, "");

  // Remove leading 0 if present
  if (normalized.startsWith("0")) {
    normalized = normalized.substring(1);
  }

  // Ensure starts with country code
  if (!normalized.startsWith("258")) {
    normalized = `258${normalized}`;
  }

  return normalized;
}

/**
 * Validate amount is within acceptable range
 *
 * Checks for minimum and maximum transaction amounts.
 */
export function isValidAmount(amount: number): boolean {
  const MIN_AMOUNT = 0.01;
  const MAX_AMOUNT = 999999.99;

  return amount >= MIN_AMOUNT && amount <= MAX_AMOUNT;
}

/**
 * Validate webhook URL is accessible
 *
 * Ensures webhook URL is properly formatted and uses HTTPS.
 */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Check if request is idempotent
 *
 * Idempotent requests with same transactionId should return same result.
 */
export function isIdempotentRequest(
  previousRequest: PaymentRequest | null,
  currentRequest: PaymentRequest
): boolean {
  if (!previousRequest) {
    return true; // First request is always idempotent
  }

  // Same transaction ID = idempotent
  return previousRequest.transactionId === currentRequest.transactionId;
}
