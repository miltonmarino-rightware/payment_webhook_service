import { describe, it, expect } from "vitest";
import * as paymentValidators from "../server/operators/mpesa/paymentRequest.validators";
import * as mpesaOutbound from "../server/operators/mpesa/mpesaOutbound.service";

describe("STK Push Payment Initiation", () => {
  describe("Payment Request Validation", () => {
    it("should validate correct payment request", async () => {
      const payload = {
        transactionId: "TXN-20250210-001",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-restaurant-api/webhooks/payment",
        amount: 500.0,
        currency: "MZN",
        phoneNumber: "258843456789",
        description: "Order #1234",
      };

      const result = await paymentValidators.validatePaymentRequest(payload);
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("should reject invalid transaction ID", async () => {
      const payload = {
        transactionId: "INVALID",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-restaurant-api/webhooks/payment",
        amount: 500.0,
        currency: "MZN",
        phoneNumber: "258843456789",
        description: "Order #1234",
      };

      const result = await paymentValidators.validatePaymentRequest(payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid transaction ID");
    });

    it("should reject negative amount", async () => {
      const payload = {
        transactionId: "TXN-20250210-001",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-restaurant-api/webhooks/payment",
        amount: -500.0,
        currency: "MZN",
        phoneNumber: "258843456789",
        description: "Order #1234",
      };

      const result = await paymentValidators.validatePaymentRequest(payload);
      expect(result.valid).toBe(false);
    });

    it("should reject non-HTTPS webhook", async () => {
      const payload = {
        transactionId: "TXN-20250210-001",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "http://internal-restaurant-api/webhooks/payment",
        amount: 500.0,
        currency: "MZN",
        phoneNumber: "258843456789",
        description: "Order #1234",
      };

      const result = await paymentValidators.validatePaymentRequest(payload);
      expect(result.valid).toBe(false);
    });

    it("should reject invalid phone number", async () => {
      const payload = {
        transactionId: "TXN-20250210-001",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-restaurant-api/webhooks/payment",
        amount: 500.0,
        currency: "MZN",
        phoneNumber: "invalid",
        description: "Order #1234",
      };

      const result = await paymentValidators.validatePaymentRequest(payload);
      expect(result.valid).toBe(false);
    });
  });

  describe("Phone Number Normalization", () => {
    it("should normalize +258 format", () => {
      const normalized = paymentValidators.normalizePhoneNumber("+258843456789");
      expect(normalized).toBe("258843456789");
    });

    it("should normalize 0 prefix format", () => {
      const normalized = paymentValidators.normalizePhoneNumber("0843456789");
      expect(normalized).toBe("258843456789");
    });

    it("should normalize 8 prefix format", () => {
      const normalized = paymentValidators.normalizePhoneNumber("843456789");
      expect(normalized).toBe("258843456789");
    });

    it("should handle already normalized format", () => {
      const normalized = paymentValidators.normalizePhoneNumber("258843456789");
      expect(normalized).toBe("258843456789");
    });
  });

  describe("Phone Number Validation", () => {
    it("should accept valid Mozambique numbers", () => {
      expect(paymentValidators.isValidPhoneNumber("258843456789")).toBe(true);
      expect(paymentValidators.isValidPhoneNumber("+258843456789")).toBe(true);
      expect(paymentValidators.isValidPhoneNumber("0843456789")).toBe(true);
      expect(paymentValidators.isValidPhoneNumber("843456789")).toBe(true);
    });

    it("should reject invalid phone numbers", () => {
      expect(paymentValidators.isValidPhoneNumber("123")).toBe(false);
      expect(paymentValidators.isValidPhoneNumber("invalid")).toBe(false);
      expect(paymentValidators.isValidPhoneNumber("258773456789")).toBe(false); // Wrong prefix (7 instead of 8)
    });
  });

  describe("Amount Validation", () => {
    it("should accept valid amounts", () => {
      expect(paymentValidators.isValidAmount(0.01)).toBe(true);
      expect(paymentValidators.isValidAmount(500.0)).toBe(true);
      expect(paymentValidators.isValidAmount(999999.99)).toBe(true);
    });

    it("should reject invalid amounts", () => {
      expect(paymentValidators.isValidAmount(0)).toBe(false);
      expect(paymentValidators.isValidAmount(-100)).toBe(false);
      expect(paymentValidators.isValidAmount(1000000)).toBe(false);
    });
  });

  describe("Webhook URL Validation", () => {
    it("should accept valid HTTPS URLs", () => {
      expect(
        paymentValidators.isValidWebhookUrl("https://internal-restaurant-api/webhooks/payment")
      ).toBe(true);
      expect(paymentValidators.isValidWebhookUrl("https://example.com/webhook")).toBe(true);
    });

    it("should reject HTTP URLs", () => {
      expect(
        paymentValidators.isValidWebhookUrl("http://internal-restaurant-api/webhooks/payment")
      ).toBe(false);
    });

    it("should reject invalid URLs", () => {
      expect(paymentValidators.isValidWebhookUrl("not-a-url")).toBe(false);
    });
  });

  describe("Idempotency", () => {
    it("should allow first request", () => {
      const request = {
        transactionId: "TXN-20250210-001",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-restaurant-api/webhooks/payment",
        amount: 500.0,
        currency: "MZN",
        phoneNumber: "258843456789",
        description: "Order #1234",
      };

      const result = paymentValidators.isIdempotentRequest(null, request);
      expect(result).toBe(true);
    });

    it("should allow duplicate request with same transactionId", () => {
      const request = {
        transactionId: "TXN-20250210-001",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-restaurant-api/webhooks/payment",
        amount: 500.0,
        currency: "MZN",
        phoneNumber: "258843456789",
        description: "Order #1234",
      };

      const result = paymentValidators.isIdempotentRequest(request, request);
      expect(result).toBe(true);
    });

    it("should reject different transactionId", () => {
      const request1 = {
        transactionId: "TXN-20250210-001",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-restaurant-api/webhooks/payment",
        amount: 500.0,
        currency: "MZN",
        phoneNumber: "258843456789",
        description: "Order #1234",
      };

      const request2 = {
        transactionId: "TXN-20250210-002",
        externalSystemId: "restaurant-pos-001",
        externalSystemWebhook: "https://internal-restaurant-api/webhooks/payment",
        amount: 500.0,
        currency: "MZN",
        phoneNumber: "258843456789",
        description: "Order #1234",
      };

      const result = paymentValidators.isIdempotentRequest(request1, request2);
      expect(result).toBe(false);
    });
  });

  describe("mPesa Outbound Service", () => {
    it("should have sendStkPushRequest function", () => {
      expect(typeof mpesaOutbound.sendStkPushRequest).toBe("function");
    });

    it("should have verifyMpesaCallbackSignature function", () => {
      expect(typeof mpesaOutbound.verifyMpesaCallbackSignature).toBe("function");
    });

    it("should have extractOperatorReference function", () => {
      expect(typeof mpesaOutbound.extractOperatorReference).toBe("function");
    });

    it("should have isPaymentSuccessful function", () => {
      expect(typeof mpesaOutbound.isPaymentSuccessful).toBe("function");
    });

    it("should have extractPaymentDetails function", () => {
      expect(typeof mpesaOutbound.extractPaymentDetails).toBe("function");
    });
  });
});
