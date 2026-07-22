import { describe, expect, it } from "vitest";
import { apiKeyPrefix, hashApiKey, hashRequestBody } from "../server/gateway/security/merchantSecurity";
import { paymentIntentErrorResponse } from "../server/gateway/payment-intents/paymentIntent.routes";

describe("Merchant security primitives", () => {
  it("creates a stable SHA-256 API key hash without retaining the key", () => {
    const key = "gw_test_ab12cd34_super-secret-value";
    const hash = hashApiKey(key);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashApiKey(key));
    expect(hash).not.toContain("super-secret-value");
  });

  it("extracts the non-secret API key prefix", () => {
    expect(apiKeyPrefix("gw_test_ab12cd34_super-secret-value")).toBe("gw_test_ab12cd34");
  });

  it("rejects malformed API keys", () => {
    expect(() => apiKeyPrefix("invalid")).toThrow("invalid_api_key");
  });

  it("creates stable request hashes", () => {
    const body = { amount: 500, currency: "MZN" };
    expect(hashRequestBody(body)).toBe(hashRequestBody(body));
    expect(hashRequestBody(body)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("distinguishes different idempotent payloads", () => {
    expect(hashRequestBody({ amount: 500 })).not.toBe(hashRequestBody({ amount: 501 }));
  });

  it("maps idempotency payload conflicts to HTTP 409", () => {
    expect(
      paymentIntentErrorResponse(
        new Error("idempotency_key_reused_with_different_payload")
      )
    ).toEqual({
      status: 409,
      body: { error: "idempotency_key_reused_with_different_payload" },
    });
  });

  it("maps merchant identity mismatch to a validation error", () => {
    expect(paymentIntentErrorResponse(new Error("merchant_id_mismatch"))).toEqual({
      status: 400,
      body: { error: "merchant_id_mismatch" },
    });
  });
});
