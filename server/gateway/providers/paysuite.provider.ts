import type {
  PaymentProvider,
  ProviderCreatePaymentInput,
  ProviderCreatePaymentResult,
} from "../types";

export class PaysuiteProvider implements PaymentProvider {
  readonly code = "paysuite" as const;

  async createPayment(input: ProviderCreatePaymentInput): Promise<ProviderCreatePaymentResult> {
    const { paymentIntent, paymentMethod } = input;

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
    // TODO: verify Paysuite signature, normalize event, update PaymentIntent status.
  }
}
