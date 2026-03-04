/**
 * Stripe Payment Validators
 * 
 * Zod schemas for validating:
 * - Stripe payment request payloads
 * - Stripe webhook events
 * - Stripe payment intent responses
 */

import { z } from "zod";

/**
 * Stripe payment request schema
 * Validates incoming payment request for card payment
 */
export const StripePaymentRequestSchema = z.object({
  transactionId: z
    .string()
    .min(1, "Transaction ID is required")
    .regex(
      /^TXN-\d{8}-[A-Z0-9]{5}$/,
      "Transaction ID must match format: TXN-YYYYMMDD-XXXXX"
    ),
  externalSystemId: z
    .string()
    .min(1, "External system ID is required")
    .max(100, "External system ID must be at most 100 characters")
    .regex(
      /^[a-z0-9\-_]+$/,
      "External system ID must contain only lowercase letters, numbers, hyphens, and underscores"
    ),
  externalSystemWebhook: z
    .string()
    .url("External system webhook must be a valid HTTPS URL")
    .startsWith("https://", "Webhook URL must use HTTPS"),
  amount: z
    .number()
    .positive("Amount must be greater than 0")
    .finite("Amount must be a finite number")
    .max(999999999, "Amount is too large"),
  currency: z
    .string()
    .length(3, "Currency must be a 3-letter ISO 4217 code")
    .regex(/^[A-Z]{3}$/, "Currency must be uppercase ISO 4217 code"),
  description: z
    .string()
    .min(1, "Description is required")
    .max(1000, "Description must be at most 1000 characters"),
  customerEmail: z
    .string()
    .email("Customer email must be a valid email address")
    .optional(),
  metadata: z
    .record(z.string(), z.string())
    .optional(),
});

export type StripePaymentRequest = z.infer<typeof StripePaymentRequestSchema>;

/**
 * Stripe webhook event schema
 * Validates incoming webhook events from Stripe
 */
export const StripeWebhookEventSchema = z.object({
  id: z.string().min(1, "Event ID is required"),
  type: z.enum([
    "payment_intent.created",
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "payment_intent.canceled",
    "charge.refunded",
  ]),
  created: z.number().positive("Event timestamp must be positive"),
  data: z.object({
    object: z.object({
      id: z.string().min(1, "Payment intent ID is required"),
      object: z.string(),
      amount: z.number().nonnegative("Amount must be non-negative"),
      currency: z.string().length(3, "Currency must be 3 characters"),
      status: z.string(),
      client_secret: z.string().optional(),
      metadata: z
        .record(z.string(), z.string())
        .optional(),
    }),
  }),
});

export type StripeWebhookEvent = z.infer<typeof StripeWebhookEventSchema>;

/**
 * Stripe webhook signature header schema
 * Validates the signature header from Stripe
 */
export const StripeWebhookSignatureSchema = z.object({
  signature: z
    .string()
    .min(1, "Stripe signature header is required"),
});

export type StripeWebhookSignature = z.infer<
  typeof StripeWebhookSignatureSchema
>;

/**
 * Stripe payment intent response schema
 * Validates the response from Stripe API
 */
export const StripePaymentIntentResponseSchema = z.object({
  clientSecret: z.string().min(1, "Client secret is required"),
  paymentIntentId: z.string().min(1, "Payment intent ID is required"),
  amount: z.number().positive("Amount must be positive"),
  currency: z.string().length(3, "Currency must be 3 characters"),
  status: z.enum([
    "requires_payment_method",
    "requires_confirmation",
    "requires_action",
    "processing",
    "succeeded",
    "canceled",
  ]),
  createdAt: z.date(),
});

export type StripePaymentIntentResponse = z.infer<
  typeof StripePaymentIntentResponseSchema
>;

/**
 * Validate Stripe payment request
 */
export function validateStripePaymentRequest(
  data: unknown
): { valid: boolean; data?: StripePaymentRequest; error?: string } {
  try {
    const validated = StripePaymentRequestSchema.parse(data);
    return { valid: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.issues
        .map((e: any) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      return { valid: false, error: errorMessage };
    }
    return { valid: false, error: "Unknown validation error" };
  }
}

/**
 * Validate Stripe webhook event
 */
export function validateStripeWebhookEvent(
  data: unknown
): { valid: boolean; data?: StripeWebhookEvent; error?: string } {
  try {
    const validated = StripeWebhookEventSchema.parse(data);
    return { valid: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.issues
        .map((e: any) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      return { valid: false, error: errorMessage };
    }
    return { valid: false, error: "Unknown validation error" };
  }
}

/**
 * Validate Stripe webhook signature header
 */
export function validateStripeWebhookSignature(
  signature: unknown
): { valid: boolean; signature?: string; error?: string } {
  try {
    const validated = StripeWebhookSignatureSchema.parse({ signature });
    return { valid: true, signature: validated.signature };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.issues
        .map((e: any) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      return { valid: false, error: errorMessage };
    }
    return { valid: false, error: "Unknown validation error" };
  }
}

/**
 * Validate Stripe payment intent response
 */
export function validateStripePaymentIntentResponse(
  data: unknown
): { valid: boolean; data?: StripePaymentIntentResponse; error?: string } {
  try {
    const validated = StripePaymentIntentResponseSchema.parse(data);
    return { valid: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.issues
        .map((e: any) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      return { valid: false, error: errorMessage };
    }
    return { valid: false, error: "Unknown validation error" };
  }
}
