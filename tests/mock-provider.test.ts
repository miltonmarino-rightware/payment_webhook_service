import { afterEach, describe, expect, it } from "vitest";
import { MockProvider } from "../server/gateway/providers/mock.provider";

const paymentIntent = {
  id: "pi_test",
  amount: 850,
  currency: "MZN" as const,
  merchantId: "merchant_test",
  status: "requires_payment_method" as const,
  clientSecret: "pi_secret_test",
  metadata: {},
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

describe("MockProvider", () => {
  afterEach(() => delete process.env.GATEAWAY_MOCK_SCENARIO);

  it("returns processing by default", async () => {
    const result = await new MockProvider().createPayment({ paymentIntent, paymentMethod: "mpesa", customerPhone: "258840000001" });
    expect(result.success).toBe(true);
    expect(result.status).toBe("processing");
    expect(result.providerReference).toMatch(/^mock_/);
  });

  it("can simulate success", async () => {
    process.env.GATEAWAY_MOCK_SCENARIO = "succeeded";
    const result = await new MockProvider().createPayment({ paymentIntent, paymentMethod: "bank" });
    expect(result.success).toBe(true);
    expect(result.status).toBe("succeeded");
  });

  it("can simulate decline without exposing secrets", async () => {
    process.env.GATEAWAY_MOCK_SCENARIO = "fail";
    const result = await new MockProvider().createPayment({ paymentIntent, paymentMethod: "card" });
    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("mock_provider_declined");
  });
});
