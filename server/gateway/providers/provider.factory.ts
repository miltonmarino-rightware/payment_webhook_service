import type { PaymentProvider, ProviderCode } from "../types";
import { PaysuiteProvider } from "./paysuite.provider";

const providers: Record<ProviderCode, PaymentProvider> = {
  paysuite: new PaysuiteProvider(),
  mpesa_direct: new PaysuiteProvider(),
  emola_direct: new PaysuiteProvider(),
  bank_direct: new PaysuiteProvider(),
};

export function resolvePaymentProvider(provider: ProviderCode = "paysuite"): PaymentProvider {
  return providers[provider] ?? providers.paysuite;
}
