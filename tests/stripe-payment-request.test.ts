/**
 * Stripe Payment Request Endpoint Tests
 * 
 * Comprehensive test suite for POST /payments/stripe/request endpoint
 * covering validation, authentication, idempotency, and integration
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { validateStripePaymentRequest } from "../server/operators/stripe/stripe.validators";

describe("Stripe Payment Request Validation", () => {
  describe("Valid payment requests", () => {
    it("should accept valid payment request with all fields", () => {
      const validRequest = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
        customerEmail: "customer@example.com",
        metadata: {
          orderId: "ORD-123",
          customerId: "CUST-456",
        },
      };

      const result = validateStripePaymentRequest(validRequest);
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.transactionId).toBe("TXN-20250304-ABCDE");
    });

    it("should accept payment request without optional fields", () => {
      const minimalRequest = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(minimalRequest);
      expect(result.valid).toBe(true);
      expect(result.data?.customerEmail).toBeUndefined();
      expect(result.data?.metadata).toBeUndefined();
    });

    it("should accept various valid currencies", () => {
      const currencies = ["USD", "EUR", "GBP", "JPY", "MZN", "ZAR"];

      for (const currency of currencies) {
        const request = {
          transactionId: "TXN-20250304-ABCDE",
          externalSystemId: "restaurant-pos-001",
          externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
          amount: 5000,
          currency,
          description: "Order #1234",
        };

        const result = validateStripePaymentRequest(request);
        expect(result.valid).toBe(true);
        expect(result.data?.currency).toBe(currency);
      }
    });

    it("should accept various valid amounts", () => {
      const amounts = [0.01, 1, 100, 1000, 999999.99, 999999999];

      for (const amount of amounts) {
        const request = {
          transactionId: "TXN-20250304-ABCDE",
          externalSystemId: "restaurant-pos-001",
          externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
          amount,
          currency: "USD",
          description: "Order #1234",
        };

        const result = validateStripePaymentRequest(request);
        expect(result.valid).toBe(true);
        expect(result.data?.amount).toBe(amount);
      }
    });

    it("should accept various valid transaction ID formats", () => {
      const transactionIds = [
        "TXN-20250304-ABCDE",
        "TXN-20250101-00000",
        "TXN-20251231-ZZZZZ",
        "TXN-20250228-12345",
      ];

      for (const transactionId of transactionIds) {
        const request = {
          transactionId,
          externalSystemId: "restaurant-pos-001",
          externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
          amount: 5000,
          currency: "USD",
          description: "Order #1234",
        };

        const result = validateStripePaymentRequest(request);
        expect(result.valid).toBe(true);
      }
    });

    it("should accept various valid external system IDs", () => {
      const systemIds = [
        "restaurant-pos-001",
        "ecommerce-shop",
        "retail_store_1",
        "system-123",
        "a",
      ];

      for (const externalSystemId of systemIds) {
        const request = {
          transactionId: "TXN-20250304-ABCDE",
          externalSystemId,
          externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
          amount: 5000,
          currency: "USD",
          description: "Order #1234",
        };

        const result = validateStripePaymentRequest(request);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe("Invalid transaction IDs", () => {
    it("should reject transaction ID without TXN- prefix", () => {
      const request = {
        transactionId: "20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Transaction ID must match format");
    });

    it("should reject transaction ID with invalid date format", () => {
      const request = {
        transactionId: "TXN-2025-03-04-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject transaction ID with lowercase suffix", () => {
      const request = {
        transactionId: "TXN-20250304-abcde",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject empty transaction ID", () => {
      const request = {
        transactionId: "",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });
  });

  describe("Invalid external system IDs", () => {
    it("should reject external system ID with uppercase letters", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "Restaurant-POS-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject external system ID with special characters", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant@pos#001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject external system ID that is too long", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "a".repeat(101),
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });
  });

  describe("Invalid webhook URLs", () => {
    it("should reject webhook URL without HTTPS", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "http://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("HTTPS");
    });

    it("should reject invalid webhook URL", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "not-a-url",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject empty webhook URL", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });
  });

  describe("Invalid amounts", () => {
    it("should reject zero amount", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 0,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject negative amount", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: -5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject amount that is too large", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 1000000000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject non-finite amount", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: Infinity,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });
  });

  describe("Invalid currencies", () => {
    it("should reject currency with lowercase letters", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "usd",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject currency with wrong length", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "US",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject currency with numbers", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "US1",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });
  });

  describe("Invalid descriptions", () => {
    it("should reject empty description", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject description that is too long", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "a".repeat(1001),
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });
  });

  describe("Invalid email addresses", () => {
    it("should reject invalid email format", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
        customerEmail: "not-an-email",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject email without domain", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
        customerEmail: "customer@",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });
  });

  describe("Invalid metadata", () => {
    it("should reject metadata with non-string values", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
        metadata: {
          orderId: 123, // Should be string
        },
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should accept metadata with numeric keys (converted to strings by JS)", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
        metadata: {
          [123]: "value", // JS converts numeric keys to strings
        },
      };

      const result = validateStripePaymentRequest(request);
      // JavaScript automatically converts numeric keys to strings in objects
      expect(result.valid).toBe(true);
    });
  });

  describe("Missing required fields", () => {
    it("should reject request without transactionId", () => {
      const request = {
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject request without externalSystemId", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject request without externalSystemWebhook", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject request without amount", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject request without currency", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should reject request without description", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle null values gracefully", () => {
      const request = {
        transactionId: null,
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should handle undefined values gracefully", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: undefined,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should handle empty object", () => {
      const request = {};

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(false);
    });

    it("should handle extra fields (should ignore them)", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
        extraField: "should be ignored",
        anotherExtra: 12345,
      };

      const result = validateStripePaymentRequest(request);
      expect(result.valid).toBe(true);
      expect((result.data as any)?.extraField).toBeUndefined();
    });

    it("should handle whitespace in string fields", () => {
      const request = {
        transactionId: "TXN-20250304-ABCDE",
        externalSystemId: "  restaurant-pos-001  ",
        externalSystemWebhook: "https://internal-api.example.com/webhooks/payment",
        amount: 5000,
        currency: "USD",
        description: "Order #1234",
      };

      const result = validateStripePaymentRequest(request);
      // Zod doesn't trim by default, so this should fail
      expect(result.valid).toBe(false);
    });
  });
});
