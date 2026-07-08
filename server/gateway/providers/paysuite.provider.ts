import type {
  PaymentProvider,
  ProviderCreatePaymentInput,
  ProviderCreatePaymentResult,
} from "../types";

/**
 * Paysuite provider adapter.
 *
 * This file is intentionally isolated from the rest of the Gateway.
 * The public Gateway API must never depend directly on Paysuite request/response shapes.
 */
export class PaysuiteProvider implements PaymentProvider {
  readonly code = "paysuite" as const;

  async createPayment(input: ProviderCreatePaymentInput): Promise<ProviderCreatePaymentResult> {
    const { paymentIntent, paymentMethod } = input;

    // TODO: Replace with real Paysuite API call when credentials and API docs are available.
    // Expected mapping:
    // Gateway PaymentIntent -> Paysuite payment request -> ProviderCreatePaymentResult
    return {
      success: true,
      status: "processing",
      providerReference: `ps_${paymentIntent.id}`,
      raw: {
        simulated: true,
        provider: this.code,
        paymentMethod,
      },
    };
  }

  async handleWebhook(_payload: unknown, _headers: Record<string, string | string[] | undefined>): Promise<void> {
    // TODO: Verify Paysuite signature, normalize event, update PaymentIntent status.
  }
}
