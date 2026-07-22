import { describe, expect, it } from "vitest";
import { paymentIntentErrorResponse } from "../server/gateway/payment-intents/paymentIntent.routes";

describe("Payment Intent public error contract", () => {
  it("returns a validation error for a missing customer phone", () => {
    expect(paymentIntentErrorResponse(new Error("customer_phone_required"))).toEqual({
      status: 400,
      body: { error: "customer_phone_required" },
    });
  });

  it("returns 503 without exposing the Paysuite token variable", () => {
    const response = paymentIntentErrorResponse(
      new Error("provider_not_configured:paysuite")
    );

    expect(response).toEqual({
      status: 503,
      body: {
        error: "provider_not_configured",
        provider: "paysuite",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("PAYSUITE_API_TOKEN");
  });

  it("sanitizes the legacy missing-token error", () => {
    expect(paymentIntentErrorResponse(new Error("paysuite_api_token_missing"))).toEqual({
      status: 503,
      body: {
        error: "provider_not_configured",
        provider: "paysuite",
      },
    });
  });

  it("does not expose unexpected internal errors", () => {
    expect(paymentIntentErrorResponse(new Error("database_password_is_wrong"))).toEqual({
      status: 500,
      body: { error: "internal_error" },
    });
  });

  it("keeps not-found behavior stable", () => {
    expect(paymentIntentErrorResponse(new Error("payment_intent_not_found"))).toEqual({
      status: 404,
      body: { error: "payment_intent_not_found" },
    });
  });
});
