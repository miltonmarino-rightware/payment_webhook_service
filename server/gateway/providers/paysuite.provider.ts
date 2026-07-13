import type {
  PaymentIntentStatus,
  PaymentProvider,
  ProviderCreatePaymentInput,
  ProviderCreatePaymentResult,
} from "../types";

type PaysuitePaymentResponse = {
  status?: string;
  message?: string;
  data?: {
    id?: string;
    amount?: number;
    reference?: string;
    status?: string;
    checkout_url?: string;
  };
};

function mapPaysuiteStatus(status?: string): PaymentIntentStatus {
  switch (status?.toLowerCase()) {
    case "paid":
    case "success":
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    case "pending":
    case "processing":
    default:
      return "processing";
  }
}

export class PaysuiteProvider implements PaymentProvider {
  readonly code = "paysuite" as const;

  async createPayment(input: ProviderCreatePaymentInput): Promise<ProviderCreatePaymentResult> {
    const token = process.env.PAYSUITE_API_TOKEN;
    const baseUrl = process.env.PAYSUITE_BASE_URL ?? "https://paysuite.tech/api/v1";

    if (!token) {
      return {
        success: false,
        status: "failed",
        error: "paysuite_api_token_missing",
      };
    }

    const payload = {
      amount: input.paymentIntent.amount.toFixed(2),
      method: input.paymentMethod === "card" ? "credit_card" : input.paymentMethod,
      reference: (input.paymentIntent.orderReference ?? input.paymentIntent.id).slice(0, 50),
      description: input.paymentIntent.description?.slice(0, 125),
      return_url: process.env.PAYSUITE_RETURN_URL,
      callback_url: process.env.PAYSUITE_CALLBACK_URL,
    };

    const response = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => ({}))) as PaysuitePaymentResponse;

    if (!response.ok || body.status === "error" || !body.data?.id) {
      return {
        success: false,
        status: "failed",
        error: body.message ?? `paysuite_http_${response.status}`,
        raw: body,
      };
    }

    return {
      success: true,
      status: mapPaysuiteStatus(body.data.status),
      providerReference: body.data.id,
      checkoutUrl: body.data.checkout_url,
      raw: body,
    };
  }

  async handleWebhook(_payload: unknown, _headers: Record<string, string | string[] | undefined>): Promise<void> {
    // Implemented in the dedicated Paysuite webhook route.
  }
}
