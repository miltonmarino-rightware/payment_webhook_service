import { describe, expect, it } from "vitest";
import {
  assertFinancialMatch,
  assertPaymentIntentTransition,
  type PaysuiteWebhookPayload,
} from "../server/gateway/webhooks/paysuiteWebhook.service";
import { errorResponse } from "../server/gateway/webhooks/paysuiteWebhook.routes";

const paymentIntent = {
  amount: "500.00",
  currency: "MZN",
  orderReference: "order_001",
  provider: "paysuite" as const,
  providerReference: "pay_001",
};

function payload(overrides: Partial<NonNullable<PaysuiteWebhookPayload["data"]>> = {}) {
  return {
    event: "payment.success",
    request_id: "req_001",
    data: {
      id: "pay_001",
      reference: "order_001",
      amount: 500,
      currency: "MZN",
      ...overrides,
    },
  };
}

describe("Paysuite webhook financial validation", () => {
  it("accepts matching amount, currency, reference, and provider reference", () => {
    expect(() => assertFinancialMatch(paymentIntent, payload())).not.toThrow();
  });

  it("rejects a different amount", () => {
    expect(() => assertFinancialMatch(paymentIntent, payload({ amount: 499 }))).toThrow(
      "paysuite_webhook_amount_mismatch"
    );
  });

  it("rejects a different currency", () => {
    expect(() => assertFinancialMatch(paymentIntent, payload({ currency: "USD" }))).toThrow(
      "paysuite_webhook_currency_mismatch"
    );
  });

  it("rejects a different order reference", () => {
    expect(() =>
      assertFinancialMatch(paymentIntent, payload({ reference: "order_other" }))
    ).toThrow("paysuite_webhook_reference_mismatch");
  });

  it("rejects a different provider reference", () => {
    expect(() => assertFinancialMatch(paymentIntent, payload({ id: "pay_other" }))).toThrow(
      "paysuite_webhook_provider_reference_mismatch"
    );
  });

  it("allows processing to reach succeeded", () => {
    expect(() => assertPaymentIntentTransition("processing", "succeeded")).not.toThrow();
  });

  it("allows an idempotent same-state transition", () => {
    expect(() => assertPaymentIntentTransition("succeeded", "succeeded")).not.toThrow();
  });

  it("rejects succeeded reverting to failed", () => {
    expect(() => assertPaymentIntentTransition("succeeded", "failed")).toThrow(
      "payment_intent_transition_not_allowed"
    );
  });

  it("rejects an unconfirmed intent becoming succeeded", () => {
    expect(() => assertPaymentIntentTransition("requires_payment_method", "succeeded")).toThrow(
      "payment_intent_transition_not_allowed"
    );
  });

  it("sanitizes financial mismatch details from the public response", () => {
    expect(errorResponse(new Error("paysuite_webhook_amount_mismatch"))).toEqual({
      status: 409,
      body: { received: false, error: "webhook_conflict" },
    });
  });
});
