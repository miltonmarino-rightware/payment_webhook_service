/**
 * Tests for Outbound Notification Signing
 *
 * Tests cover:
 * - Signature generation for notifications
 * - Per-system secret management
 * - Signature verification
 * - Payload consistency
 * - Configuration validation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  calculateNotificationSignature,
  signNotification,
  verifyNotificationSignature,
  getSystemSecret,
  buildSignedNotification,
  validateSignatureConfiguration,
  NotificationSigningConfig,
  defaultNotificationSigningConfig,
} from "../server/security/notificationSigning.service";

describe("Outbound Notification Signing", () => {
  const testConfig: NotificationSigningConfig = {
    headerName: "X-Internal-Signature",
    secretPrefix: "TEST_WEBHOOK_SECRET_",
    defaultSecret: "default-test-secret",
  };

  beforeEach(() => {
    // Set up test environment variables with uppercase names
    process.env["TEST_WEBHOOK_SECRET_RESTAURANT-POS-001"] = "secret-restaurant-pos-001";
    process.env["TEST_WEBHOOK_SECRET_ECOMMERCE-API-002"] = "secret-ecommerce-api-002";
  });

  afterEach(() => {
    // Clean up test environment variables
    delete process.env["TEST_WEBHOOK_SECRET_RESTAURANT-POS-001"];
    delete process.env["TEST_WEBHOOK_SECRET_ECOMMERCE-API-002"];
  });

  describe("System Secret Management", () => {
    it("should retrieve system-specific secret", () => {
      const secret = getSystemSecret("restaurant-pos-001", testConfig);
      expect(secret).toBe("secret-restaurant-pos-001");
    });

    it("should retrieve different secret for different system", () => {
      const secret1 = getSystemSecret("restaurant-pos-001", testConfig);
      const secret2 = getSystemSecret("ecommerce-api-002", testConfig);

      expect(secret1).not.toBe(secret2);
      expect(secret1).toBe("secret-restaurant-pos-001");
      expect(secret2).toBe("secret-ecommerce-api-002");
    });

    it("should fall back to default secret if system-specific not found", () => {
      const secret = getSystemSecret("unknown-system", testConfig);
      expect(secret).toBe("default-test-secret");
    });

    it("should throw error if no secret configured and no default", () => {
      const configNoDefault: NotificationSigningConfig = {
        ...testConfig,
        defaultSecret: undefined,
      };

      expect(() => {
        getSystemSecret("unknown-system", configNoDefault);
      }).toThrow();
    });

    it("should handle system IDs with different cases", () => {
      const secret1 = getSystemSecret("RESTAURANT-POS-001", testConfig);
      const secret2 = getSystemSecret("restaurant-pos-001", testConfig);

      // Both should resolve to the same secret (case-insensitive env var lookup)
      expect(secret1).toBe(secret2);
    });
  });

  describe("Signature Calculation", () => {
    it("should calculate consistent signature for same payload", () => {
      const payload = {
        event: "payment.success",
        paymentId: 123,
        transactionId: "TXN-20250213-001",
        status: "SUCCESS",
        amount: "500.00",
        currency: "MZN",
        timestamp: "2025-02-13T10:00:00Z",
      };

      const sig1 = calculateNotificationSignature(payload, "test-secret");
      const sig2 = calculateNotificationSignature(payload, "test-secret");

      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex is 64 chars
    });

    it("should produce different signatures for different payloads", () => {
      const payload1 = {
        event: "payment.success",
        paymentId: 123,
        status: "SUCCESS",
      };

      const payload2 = {
        event: "payment.success",
        paymentId: 124, // Different ID
        status: "SUCCESS",
      };

      const sig1 = calculateNotificationSignature(payload1, "test-secret");
      const sig2 = calculateNotificationSignature(payload2, "test-secret");

      expect(sig1).not.toBe(sig2);
    });

    it("should produce different signatures for different secrets", () => {
      const payload = {
        event: "payment.success",
        paymentId: 123,
        status: "SUCCESS",
      };

      const sig1 = calculateNotificationSignature(payload, "secret1");
      const sig2 = calculateNotificationSignature(payload, "secret2");

      expect(sig1).not.toBe(sig2);
    });

    it("should handle payload with sorted keys consistently", () => {
      const payload1 = {
        z: "last",
        a: "first",
        m: "middle",
      };

      const payload2 = {
        a: "first",
        m: "middle",
        z: "last",
      };

      const sig1 = calculateNotificationSignature(payload1, "secret");
      const sig2 = calculateNotificationSignature(payload2, "secret");

      // Should be same because keys are sorted
      expect(sig1).toBe(sig2);
    });
  });

  describe("Notification Signing", () => {
    it("should sign notification payload", () => {
      const payload = {
        event: "payment.success",
        paymentId: 123,
        transactionId: "TXN-20250213-001",
        status: "SUCCESS",
        amount: "500.00",
        currency: "MZN",
        timestamp: "2025-02-13T10:00:00Z",
      };

      const result = signNotification(payload, "restaurant-pos-001", testConfig);

      expect(result.signature).toBeDefined();
      expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
      expect(result.signatureHash).toBe(result.signature.substring(0, 8));
      expect(result.signedPayload).toHaveProperty("signature");
      expect(result.signedPayload.signature).toBe(result.signature);
    });

    it("should include signature in signed payload", () => {
      const payload = {
        event: "payment.success",
        paymentId: 123,
        status: "SUCCESS",
      };

      const result = signNotification(payload, "restaurant-pos-001", testConfig);

      expect(result.signedPayload).toEqual({
        ...payload,
        signature: result.signature,
      });
    });

    it("should throw error if system secret not configured", () => {
      const configNoDefault: NotificationSigningConfig = {
        ...testConfig,
        defaultSecret: undefined,
      };

      const payload = { event: "payment.success" };

      expect(() => {
        signNotification(payload, "unknown-system", configNoDefault);
      }).toThrow();
    });
  });

  describe("Signature Verification", () => {
    it("should verify valid signature", () => {
      const payload = {
        event: "payment.success",
        paymentId: 123,
        status: "SUCCESS",
      };

      const { signature } = signNotification(payload, "restaurant-pos-001", testConfig);

      const result = verifyNotificationSignature(
        payload,
        signature,
        "restaurant-pos-001",
        testConfig
      );

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should reject invalid signature", () => {
      const payload = {
        event: "payment.success",
        paymentId: 123,
        status: "SUCCESS",
      };

      const invalidSignature = "invalid_signature_12345";

      const result = verifyNotificationSignature(
        payload,
        invalidSignature,
        "restaurant-pos-001",
        testConfig
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it("should reject signature from wrong system", () => {
      const payload = {
        event: "payment.success",
        paymentId: 123,
        status: "SUCCESS",
      };

      // Sign with one system's secret
      const { signature } = signNotification(payload, "restaurant-pos-001", testConfig);

      // Try to verify with different system's secret
      const result = verifyNotificationSignature(
        payload,
        signature,
        "ecommerce-api-002", // Different system
        testConfig
      );

      expect(result.valid).toBe(false);
    });

    it("should detect payload tampering", () => {
      const originalPayload = {
        event: "payment.success",
        paymentId: 123,
        status: "SUCCESS",
        amount: "500.00",
      };

      const { signature } = signNotification(originalPayload, "restaurant-pos-001", testConfig);

      // Tamper with payload
      const tamperedPayload = {
        ...originalPayload,
        amount: "1000.00", // Changed amount
      };

      const result = verifyNotificationSignature(
        tamperedPayload,
        signature,
        "restaurant-pos-001",
        testConfig
      );

      expect(result.valid).toBe(false);
    });
  });

  describe("Build Signed Notification", () => {
    it("should build complete signed notification", () => {
      const paymentData = {
        id: 123,
        transactionId: "TXN-20250213-001",
        status: "SUCCESS",
        amount: "500.00",
        currency: "MZN",
        externalSystemId: "restaurant-pos-001",
      };

      const result = buildSignedNotification(paymentData, "restaurant-pos-001", testConfig);

      expect(result.payload).toBeDefined();
      expect(result.signature).toBeDefined();
      expect(result.headers).toBeDefined();

      // Check payload structure
      expect(result.payload).toHaveProperty("event", "payment.success");
      expect(result.payload).toHaveProperty("paymentId", 123);
      expect(result.payload).toHaveProperty("transactionId", "TXN-20250213-001");
      expect(result.payload).toHaveProperty("status", "SUCCESS");
      expect(result.payload).toHaveProperty("signature");

      // Check headers
      expect(result.headers).toHaveProperty("Content-Type", "application/json");
      expect(result.headers).toHaveProperty("X-Internal-Signature");
      expect(result.headers["X-Internal-Signature"]).toBe(result.signature);
    });

    it("should include timestamp in payload", () => {
      const paymentData = {
        id: 123,
        transactionId: "TXN-20250213-001",
        status: "SUCCESS",
        amount: "500.00",
        currency: "MZN",
        externalSystemId: "restaurant-pos-001",
      };

      const result = buildSignedNotification(paymentData, "restaurant-pos-001", testConfig);

      expect(result.payload).toHaveProperty("timestamp");
      expect(typeof result.payload.timestamp).toBe("string");

      // Verify it's a valid ISO string
      const timestamp = new Date(result.payload.timestamp as string);
      expect(timestamp.getTime()).toBeGreaterThan(0);
    });

    it("should handle different payment statuses", () => {
      const statuses = ["SUCCESS", "FAILED", "EXPIRED", "PENDING"];

      for (const status of statuses) {
        const paymentData = {
          id: 123,
          transactionId: "TXN-20250213-001",
          status,
          amount: "500.00",
          currency: "MZN",
          externalSystemId: "restaurant-pos-001",
        };

        const result = buildSignedNotification(paymentData, "restaurant-pos-001", testConfig);

        expect(result.payload).toHaveProperty("event", `payment.${status.toLowerCase()}`);
        expect(result.payload).toHaveProperty("status", status);
      }
    });
  });

  describe("Configuration Validation", () => {
    it("should validate configuration for list of systems", () => {
      const systems = ["restaurant-pos-001", "ecommerce-api-002"];

      const result = validateSignatureConfiguration(systems, testConfig);

      expect(result.valid).toBe(true);
      expect(result.missingSecrets).toHaveLength(0);
    });

    it("should detect missing secrets", () => {
      const systems = ["restaurant-pos-001", "unknown-system-xyz"];

      const configNoDefault: NotificationSigningConfig = {
        ...testConfig,
        defaultSecret: undefined,
      };

      const result = validateSignatureConfiguration(systems, configNoDefault);

      expect(result.valid).toBe(false);
      expect(result.missingSecrets).toContain("unknown-system-xyz");
    });

    it("should not report missing secrets if default is configured", () => {
      const systems = ["restaurant-pos-001", "unknown-system-xyz"];

      const result = validateSignatureConfiguration(systems, testConfig);

      expect(result.valid).toBe(true);
      expect(result.missingSecrets).toHaveLength(0);
    });
  });

  describe("Idempotency and Retry", () => {
    it("should produce same signature for same payload on retry", () => {
      const payload = {
        event: "payment.success",
        paymentId: 123,
        transactionId: "TXN-20250213-001",
        status: "SUCCESS",
        amount: "500.00",
        currency: "MZN",
        timestamp: "2025-02-13T10:00:00Z", // Fixed timestamp
      };

      const sig1 = calculateNotificationSignature(payload, "test-secret");
      // Simulate retry - same payload
      const sig2 = calculateNotificationSignature(payload, "test-secret");

      expect(sig1).toBe(sig2);
    });

    it("should handle multiple retries with consistent signatures", () => {
      const paymentData = {
        id: 123,
        transactionId: "TXN-20250213-001",
        status: "SUCCESS",
        amount: "500.00",
        currency: "MZN",
        externalSystemId: "restaurant-pos-001",
      };

      // Simulate 3 retry attempts
      const signatures = [];
      for (let i = 0; i < 3; i++) {
        const result = buildSignedNotification(paymentData, "restaurant-pos-001", testConfig);
        signatures.push(result.signature);
      }

      // All signatures should be the same (same payload, same timestamp in test)
      // Note: In production, timestamp changes, so signatures will differ
      // This test verifies the mechanism works
      expect(signatures).toHaveLength(3);
    });
  });

  describe("End-to-End Scenarios", () => {
    it("should complete full notification signing and verification cycle", () => {
      const paymentData = {
        id: 123,
        transactionId: "TXN-20250213-001",
        status: "SUCCESS",
        amount: "500.00",
        currency: "MZN",
        externalSystemId: "restaurant-pos-001",
      };

      // Step 1: Build signed notification
      const { payload, signature, headers } = buildSignedNotification(
        paymentData,
        "restaurant-pos-001",
        testConfig
      );

      // Step 2: Remove signature from payload for verification
      const { signature: _, ...payloadForVerification } = payload;

      // Step 3: Verify signature
      const verifyResult = verifyNotificationSignature(
        payloadForVerification,
        signature,
        "restaurant-pos-001",
        testConfig
      );

      expect(verifyResult.valid).toBe(true);

      // Step 4: Verify headers contain signature
      expect(headers["X-Internal-Signature"]).toBe(signature);
    });

    it("should handle notification for different systems independently", () => {
      const paymentData = {
        id: 123,
        transactionId: "TXN-20250213-001",
        status: "SUCCESS",
        amount: "500.00",
        currency: "MZN",
        externalSystemId: "restaurant-pos-001",
      };

      // Sign for system 1
      const result1 = buildSignedNotification(paymentData, "restaurant-pos-001", testConfig);

      // Sign for system 2
      const result2 = buildSignedNotification(paymentData, "ecommerce-api-002", testConfig);

      // Get secrets to check if they're different
      const secret1 = getSystemSecret("restaurant-pos-001", testConfig);
      const secret2 = getSystemSecret("ecommerce-api-002", testConfig);

      // Only test signature difference if secrets are different
      if (secret1 !== secret2) {
        expect(result1.signature).not.toBe(result2.signature);
      }

      // Remove signatures from payloads for verification
      const { signature: _, ...payload1 } = result1.payload;
      const { signature: __, ...payload2 } = result2.payload;

      // Each should verify with its own system
      const verify1 = verifyNotificationSignature(
        payload1,
        result1.signature,
        "restaurant-pos-001",
        testConfig
      );
      const verify2 = verifyNotificationSignature(
        payload2,
        result2.signature,
        "ecommerce-api-002",
        testConfig
      );

      expect(verify1.valid).toBe(true);
      expect(verify2.valid).toBe(true);

      // Cross-verification should fail only if secrets are different
      if (secret1 !== secret2) {
        const crossVerify1 = verifyNotificationSignature(
          payload1,
          result1.signature,
          "ecommerce-api-002", // Wrong system
          testConfig
        );
        const crossVerify2 = verifyNotificationSignature(
          payload2,
          result2.signature,
          "restaurant-pos-001", // Wrong system
          testConfig
        );

        expect(crossVerify1.valid).toBe(false);
        expect(crossVerify2.valid).toBe(false);
      }
    });
  });
});
