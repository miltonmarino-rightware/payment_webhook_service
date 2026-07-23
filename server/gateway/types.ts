export type GatewayCurrency = "MZN";

export type PaymentIntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export type PaymentMethodType = "mpesa" | "emola" | "bank" | "card";

export type ProviderCode = "paysuite" | "mock" | "mpesa_direct" | "emola_direct" | "bank_direct";

export interface CreatePaymentIntentInput {
  amount: number;
  currency: GatewayCurrency;
  merchantId: string;
  orderReference?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: GatewayCurrency;
  merchantId: string;
  orderReference?: string;
  description?: string;
  status: PaymentIntentStatus;
  paymentMethod?: PaymentMethodType;
  provider?: ProviderCode;
  providerReference?: string;
  checkoutUrl?: string;
  clientSecret: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConfirmPaymentIntentInput {
  paymentMethod: PaymentMethodType;
  customerPhone?: string;
  provider?: ProviderCode;
}

export interface ProviderCreatePaymentInput {
  paymentIntent: PaymentIntent;
  paymentMethod: PaymentMethodType;
  customerPhone?: string;
}

export interface ProviderCreatePaymentResult {
  success: boolean;
  providerReference?: string;
  checkoutUrl?: string;
  status: PaymentIntentStatus;
  raw?: unknown;
  error?: string;
}

export interface PaymentProvider {
  readonly code: ProviderCode;
  createPayment(input: ProviderCreatePaymentInput): Promise<ProviderCreatePaymentResult>;
  handleWebhook(payload: unknown, headers: Record<string, string | string[] | undefined>): Promise<void>;
}
