import type { PaymentProvider, ProviderCode } from "../types";
import { MockProvider } from "./mock.provider";
import { PaysuiteProvider } from "./paysuite.provider";

const providers: Partial<Record<ProviderCode, PaymentProvider>> = {
  paysuite: new PaysuiteProvider(),
  mock: new MockProvider(),
};

export function resolvePaymentProvider(provider: ProviderCode = "paysuite"): PaymentProvider {
  const resolved = providers[provider];

  if (!resolved) {
    throw new Error(`payment_provider_not_implemented:${provider}`);
  }

  return resolved;
}
