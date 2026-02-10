import { describe, it, expect } from "vitest";
import * as validators from "../server/validators";
import { createHmac } from "crypto";

describe("Webhook Validators", () => {
  describe("validateSignature", () => {
    it("should validate correct signature", () => {
      const secret = "test-secret";
      const payload = {
        transactionId: "TXN-20250210-001",
        amount: 500,
        status: "SUCCESS",
      };

      const canonical = JSON.stringify(payload, Object.keys(payload).sort());
      const signature = createHmac("sha256", secret).update(canonical).digest("hex");

      const isValid = validators.validateSignature(
        { ...payload, signature },
        signature,
        secret
      );

      expect(isValid).toBe(true);
    });

    it("should reject invalid signature", () => {
      const secret = "test-secret";
      const payload = {
        transactionId: "TXN-20250210-001",
        amount: 500,
        status: "SUCCESS",
      };

      const isValid = validators.validateSignature(
        { ...payload, signature: "invalid-signature" },
        "invalid-signature",
        secret
      );

      expect(isValid).toBe(false);
    });
  });

  describe("isValidStateTransition", () => {
    it("should allow CREATED -> PENDING", () => {
      expect(validators.isValidStateTransition("CREATED", "PENDING")).toBe(true);
    });

    it("should allow PENDING -> SUCCESS", () => {
      expect(validators.isValidStateTransition("PENDING", "SUCCESS")).toBe(true);
    });

    it("should allow PENDING -> FAILED", () => {
      expect(validators.isValidStateTransition("PENDING", "FAILED")).toBe(true);
    });

    it("should allow PENDING -> EXPIRED", () => {
      expect(validators.isValidStateTransition("PENDING", "EXPIRED")).toBe(true);
    });

    it("should allow SUCCESS -> COMPLETED", () => {
      expect(validators.isValidStateTransition("SUCCESS", "COMPLETED")).toBe(true);
    });

    it("should reject invalid transitions", () => {
      expect(validators.isValidStateTransition("CREATED", "SUCCESS")).toBe(false);
      expect(validators.isValidStateTransition("SUCCESS", "PENDING")).toBe(false);
      expect(validators.isValidStateTransition("COMPLETED", "PENDING")).toBe(false);
    });
  });

  describe("isValidTransactionId", () => {
    it("should validate correct transaction ID format", () => {
      expect(validators.isValidTransactionId("TXN-20250210-001")).toBe(true);
      expect(validators.isValidTransactionId("TXN-20250210-ABCDE")).toBe(true);
      expect(validators.isValidTransactionId("TXN-20250210-12345")).toBe(true);
    });

    it("should reject invalid transaction ID format", () => {
      expect(validators.isValidTransactionId("TXN-2025-001")).toBe(false);
      expect(validators.isValidTransactionId("TXN-20250210")).toBe(false);
      expect(validators.isValidTransactionId("20250210-001")).toBe(false);
      expect(validators.isValidTransactionId("TXN-20250210-")).toBe(false);
    });
  });

  describe("isRecentTimestamp", () => {
    it("should accept recent timestamps", () => {
      const now = new Date().toISOString();
      expect(validators.isRecentTimestamp(now)).toBe(true);
    });

    it("should reject old timestamps", () => {
      const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
      expect(validators.isRecentTimestamp(oldTime)).toBe(false);
    });

    it("should reject future timestamps", () => {
      const futureTime = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes in future
      expect(validators.isRecentTimestamp(futureTime)).toBe(false);
    });
  });

  describe("validateWebhookPayload", () => {
    it("should validate correct payload", async () => {
      const payload = {
        transactionId: "TXN-20250210-001",
        amount: 500,
        currency: "MZN",
        status: "SUCCESS",
        operatorReference: "MPESA-ABC123",
        timestamp: new Date().toISOString(),
        signature: "test-signature",
      };

      const result = await validators.validateWebhookPayload(payload);
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("should reject payload with invalid transaction ID", async () => {
      const payload = {
        transactionId: "INVALID",
        amount: 500,
        currency: "MZN",
        status: "SUCCESS",
        operatorReference: "MPESA-ABC123",
        timestamp: new Date().toISOString(),
        signature: "test-signature",
      };

      const result = await validators.validateWebhookPayload(payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid transaction ID");
    });

    it("should reject payload with missing required fields", async () => {
      const payload = {
        amount: 500,
        // missing transactionId, status, etc.
      };

      const result = await validators.validateWebhookPayload(payload);
      expect(result.valid).toBe(false);
    });

    it("should reject payload with negative amount", async () => {
      const payload = {
        transactionId: "TXN-20250210-001",
        amount: -500,
        currency: "MZN",
        status: "SUCCESS",
        operatorReference: "MPESA-ABC123",
        timestamp: new Date().toISOString(),
        signature: "test-signature",
      };

      const result = await validators.validateWebhookPayload(payload);
      expect(result.valid).toBe(false);
    });
  });

  describe("calculateNextRetryTime", () => {
    it("should calculate correct retry times", () => {
      const now = Date.now();

      // First attempt: 5 seconds
      const retry1 = validators.calculateNextRetryTime(0);
      expect(retry1.getTime() - now).toBeGreaterThanOrEqual(4900);
      expect(retry1.getTime() - now).toBeLessThanOrEqual(5100);

      // Second attempt: 30 seconds
      const retry2 = validators.calculateNextRetryTime(1);
      expect(retry2.getTime() - now).toBeGreaterThanOrEqual(29900);
      expect(retry2.getTime() - now).toBeLessThanOrEqual(30100);

      // Fifth attempt: 1 hour
      const retry5 = validators.calculateNextRetryTime(4);
      expect(retry5.getTime() - now).toBeGreaterThanOrEqual(3599900);
      expect(retry5.getTime() - now).toBeLessThanOrEqual(3600100);
    });
  });

  describe("shouldRetryNotification", () => {
    it("should allow retry for attempts < 5", () => {
      expect(validators.shouldRetryNotification(0)).toBe(true);
      expect(validators.shouldRetryNotification(1)).toBe(true);
      expect(validators.shouldRetryNotification(2)).toBe(true);
      expect(validators.shouldRetryNotification(3)).toBe(true);
      expect(validators.shouldRetryNotification(4)).toBe(true);
    });

    it("should not allow retry after 5 attempts", () => {
      expect(validators.shouldRetryNotification(5)).toBe(false);
      expect(validators.shouldRetryNotification(6)).toBe(false);
    });
  });
});
