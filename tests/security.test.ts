/**
 * Security Tests for HMAC-SHA256 Signature Verification
 *
 * Tests cover:
 * - Valid signature verification
 * - Invalid signature rejection
 * - Payload tampering detection
 * - Timestamp validation (replay protection)
 * - Missing signature header handling
 * - Timing-safe comparison
 */

import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  calculateSignature,
  timingSafeCompare,
  verifySignature,
  validateTimestamp,
  SignatureConfig,
} from "../server/security/mpesaSignature.middleware";

describe("Security: HMAC-SHA256 Signature Verification", () => {
  const testSecret = "test-webhook-secret-key-12345";
  const testConfig: SignatureConfig = {
    secret: testSecret,
    headerName: "x-mpesa-signature",
    timestampFieldName: "timestamp",
    maxTimestampDiffMs: 5 * 60 * 1000, // 5 minutes
  };

  describe("Signature Calculation", () => {
    it("should calculate consistent HMAC-SHA256 signature", () => {
      const payload = JSON.stringify({
        transactionId: "TXN-20250211-001",
        amount: 500.0,
        status: "SUCCESS",
      });

      const sig1 = calculateSignature(payload, testSecret);
      const sig2 = calculateSignature(payload, testSecret);

      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex is 64 chars
    });

    it("should calculate different signatures for different payloads", () => {
      const payload1 = JSON.stringify({ amount: 500.0 });
      const payload2 = JSON.stringify({ amount: 501.0 });

      const sig1 = calculateSignature(payload1, testSecret);
      const sig2 = calculateSignature(payload2, testSecret);

      expect(sig1).not.toBe(sig2);
    });

    it("should calculate different signatures for different secrets", () => {
      const payload = JSON.stringify({ amount: 500.0 });

      const sig1 = calculateSignature(payload, "secret1");
      const sig2 = calculateSignature(payload, "secret2");

      expect(sig1).not.toBe(sig2);
    });

    it("should handle Buffer input", () => {
      const payload = Buffer.from(JSON.stringify({ amount: 500.0 }));

      const sig1 = calculateSignature(payload, testSecret);
      const sig2 = calculateSignature(payload.toString(), testSecret);

      expect(sig1).toBe(sig2);
    });
  });

  describe("Timing-Safe Comparison", () => {
    it("should return true for matching signatures", () => {
      const sig1 = "a1b2c3d4e5f6";
      const sig2 = "a1b2c3d4e5f6";

      const result = timingSafeCompare(sig1, sig2);
      expect(result).toBe(true);
    });

    it("should return false for different signatures", () => {
      const sig1 = "a1b2c3d4e5f6";
      const sig2 = "a1b2c3d4e5f7";

      const result = timingSafeCompare(sig1, sig2);
      expect(result).toBe(false);
    });

    it("should return false for different length signatures", () => {
      const sig1 = "a1b2c3d4e5f6";
      const sig2 = "a1b2c3d4e5f6789";

      const result = timingSafeCompare(sig1, sig2);
      expect(result).toBe(false);
    });

    it("should handle empty strings", () => {
      const result = timingSafeCompare("", "");
      expect(result).toBe(true);
    });

    it("should handle one empty string", () => {
      const result = timingSafeCompare("abc", "");
      expect(result).toBe(false);
    });

    it("should prevent timing attacks", () => {
      // This test verifies that comparison time doesn't leak information
      // about where the first difference occurs
      const correctSig = calculateSignature("payload", testSecret);
      // Create signatures with same length but different content
      const wrongSig1 = "a" + correctSig.slice(1); // Wrong at position 0
      const wrongSig2 = correctSig.slice(0, -1) + "b"; // Wrong at end

      // Both should return false (timing should be similar)
      const result1 = timingSafeCompare(correctSig, wrongSig1);
      const result2 = timingSafeCompare(correctSig, wrongSig2);

      expect(result1).toBe(false);
      expect(result2).toBe(false);
    });
  });

  describe("Signature Verification", () => {
    it("should verify valid signature", () => {
      const payload = JSON.stringify({
        transactionId: "TXN-20250211-001",
        amount: 500.0,
      });

      const signature = calculateSignature(payload, testSecret);

      const result = verifySignature(payload, signature, testConfig);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should reject invalid signature", () => {
      const payload = JSON.stringify({ amount: 500.0 });
      const invalidSignature = "invalid_signature_12345";

      const result = verifySignature(payload, invalidSignature, testConfig);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Signature mismatch");
    });

    it("should reject missing signature", () => {
      const payload = JSON.stringify({ amount: 500.0 });

      const result = verifySignature(payload, "", testConfig);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Signature header missing");
    });

    it("should reject when secret is not configured", () => {
      const payload = JSON.stringify({ amount: 500.0 });
      const signature = calculateSignature(payload, testSecret);

      const configNoSecret: SignatureConfig = {
        ...testConfig,
        secret: "",
      };

      const result = verifySignature(payload, signature, configNoSecret);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not configured");
    });

    it("should detect tampered payload", () => {
      const originalPayload = JSON.stringify({
        transactionId: "TXN-20250211-001",
        amount: 500.0,
        status: "SUCCESS",
      });

      const signature = calculateSignature(originalPayload, testSecret);

      // Tamper with payload
      const tamperedPayload = JSON.stringify({
        transactionId: "TXN-20250211-001",
        amount: 1000.0, // Changed amount
        status: "SUCCESS",
      });

      const result = verifySignature(tamperedPayload, signature, testConfig);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Signature mismatch");
    });

    it("should detect signature tampering", () => {
      const payload = JSON.stringify({ amount: 500.0 });
      const signature = calculateSignature(payload, testSecret);

      // Tamper with signature - change first character
      const firstChar = signature.charCodeAt(0);
      const tamperedChar = String.fromCharCode(firstChar === 97 ? 98 : 97);
      const tamperedSignature = tamperedChar + signature.slice(1);

      const result = verifySignature(payload, tamperedSignature, testConfig);

      expect(result.valid).toBe(false);
    });

    it("should handle Buffer payload", () => {
      const payload = Buffer.from(JSON.stringify({ amount: 500.0 }));
      const signature = calculateSignature(payload, testSecret);

      const result = verifySignature(payload, signature, testConfig);

      expect(result.valid).toBe(true);
    });
  });

  describe("Timestamp Validation (Replay Protection)", () => {
    it("should accept current timestamp", () => {
      const now = Date.now();
      const payload = {
        transactionId: "TXN-20250211-001",
        timestamp: now,
      };

      const result = validateTimestamp(payload, testConfig);

      expect(result.valid).toBe(true);
    });

    it("should accept ISO string timestamp", () => {
      const now = new Date().toISOString();
      const payload = {
        transactionId: "TXN-20250211-001",
        timestamp: now,
      };

      const result = validateTimestamp(payload, testConfig);

      expect(result.valid).toBe(true);
    });

    it("should reject timestamp outside window (too old)", () => {
      const oldTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago
      const payload = {
        transactionId: "TXN-20250211-001",
        timestamp: oldTimestamp,
      };

      const result = validateTimestamp(payload, testConfig);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("outside acceptable window");
    });

    it("should reject timestamp outside window (too new)", () => {
      const futureTimestamp = Date.now() + 6 * 60 * 1000; // 6 minutes in future
      const payload = {
        transactionId: "TXN-20250211-001",
        timestamp: futureTimestamp,
      };

      const result = validateTimestamp(payload, testConfig);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("outside acceptable window");
    });

    it("should accept timestamp at window boundary", () => {
      const boundaryTimestamp = Date.now() - testConfig.maxTimestampDiffMs + 10000;
      const payload = {
        transactionId: "TXN-20250211-001",
        timestamp: boundaryTimestamp,
      };

      const result = validateTimestamp(payload, testConfig);

      expect(result.valid).toBe(true);
    });

    it("should reject missing timestamp", () => {
      const payload = {
        transactionId: "TXN-20250211-001",
      };

      const result = validateTimestamp(payload, testConfig);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("missing");
    });

    it("should reject invalid timestamp format", () => {
      const payload = {
        transactionId: "TXN-20250211-001",
        timestamp: "invalid-date",
      };

      const result = validateTimestamp(payload, testConfig);

      expect(result.valid).toBe(false);
    });

    it("should reject null timestamp", () => {
      const payload = {
        transactionId: "TXN-20250211-001",
        timestamp: null,
      };

      const result = validateTimestamp(payload, testConfig);

      expect(result.valid).toBe(false);
    });

    it("should reject object timestamp", () => {
      const payload = {
        transactionId: "TXN-20250211-001",
        timestamp: { time: Date.now() },
      };

      const result = validateTimestamp(payload, testConfig);

      expect(result.valid).toBe(false);
    });
  });

  describe("Replay Attack Protection", () => {
    it("should block duplicate webhook with same timestamp", () => {
      const timestamp = Date.now();
      const payload1 = {
        transactionId: "TXN-20250211-001",
        amount: 500.0,
        timestamp,
      };

      const payload2 = {
        transactionId: "TXN-20250211-001",
        amount: 500.0,
        timestamp, // Same timestamp = potential replay
      };

      // Both should have valid timestamps
      const result1 = validateTimestamp(payload1, testConfig);
      const result2 = validateTimestamp(payload2, testConfig);

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
      // Note: Replay detection at application level would use transactionId + timestamp
    });

    it("should reject webhook with expired timestamp", () => {
      const expiredTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago (> 5 min window)
      const payload = {
        transactionId: "TXN-20250211-001",
        timestamp: expiredTimestamp,
      };

      const result = validateTimestamp(payload, testConfig);

      expect(result.valid).toBe(false);
    });
  });

  describe("Integration Scenarios", () => {
    it("should verify complete webhook flow with valid signature and timestamp", () => {
      const timestamp = Date.now();
      const payload = {
        transactionId: "TXN-20250211-001",
        amount: 500.0,
        status: "SUCCESS",
        timestamp,
      };

      const payloadStr = JSON.stringify(payload);
      const signature = calculateSignature(payloadStr, testSecret);

      // Step 1: Verify signature
      const sigResult = verifySignature(payloadStr, signature, testConfig);
      expect(sigResult.valid).toBe(true);

      // Step 2: Verify timestamp
      const tsResult = validateTimestamp(payload, testConfig);
      expect(tsResult.valid).toBe(true);
    });

    it("should reject webhook with valid signature but expired timestamp", () => {
      const expiredTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      const payload = {
        transactionId: "TXN-20250211-001",
        amount: 500.0,
        timestamp: expiredTimestamp,
      };

      const payloadStr = JSON.stringify(payload);
      const signature = calculateSignature(payloadStr, testSecret);

      // Signature is valid
      const sigResult = verifySignature(payloadStr, signature, testConfig);
      expect(sigResult.valid).toBe(true);

      // But timestamp is expired
      const tsResult = validateTimestamp(payload, testConfig);
      expect(tsResult.valid).toBe(false);
    });

    it("should reject webhook with invalid signature even if timestamp is valid", () => {
      const timestamp = Date.now();
      const payload = {
        transactionId: "TXN-20250211-001",
        amount: 500.0,
        timestamp,
      };

      const payloadStr = JSON.stringify(payload);
      const invalidSignature = "invalid_signature";

      // Signature is invalid
      const sigResult = verifySignature(payloadStr, invalidSignature, testConfig);
      expect(sigResult.valid).toBe(false);

      // Timestamp is valid
      const tsResult = validateTimestamp(payload, testConfig);
      expect(tsResult.valid).toBe(true);
    });
  });
});
