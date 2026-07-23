import crypto from "crypto";
import type {
  PaymentProvider,
  ProviderCreatePaymentInput,
  ProviderCreatePaymentResult,
} from "../types";

export class MockProvider implements PaymentProvider {
  readonly code = "mock" as const;

  async createPayment(input: ProviderCreatePaymentInput): Promise<ProviderCreatePaymentResult> {
    const scenario = process.env.GATEAWAY_MOCK_SCENARIO ?? "processing";
    const providerReference = `mock_${crypto.randomBytes(12).toString("hex")}`;

    if (scenario === "fail") {
      return {
        success: false,
        status: "failed",
        error: "mock_provider_declined",
        raw: { scenario, providerReference },
      };
    }

    const status = scenario === "succeeded" ? "succeeded" : "processing";
    return {
      success: true,
      status,
      providerReference,
      checkoutUrl: `http://localhost:3000/sandbox/payments/${providerReference}`,
      raw: {
        provider: "mock",
        scenario,
        paymentIntentId: input.paymentIntent.id,
        paymentMethod: input.paymentMethod,
        customerPhonePresent: Boolean(input.customerPhone),
      },
    };
  }

  async handleWebhook(): Promise<void> {
    return;
  }
}
