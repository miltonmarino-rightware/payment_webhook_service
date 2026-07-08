import type { PaymentProvider, ProviderCode } from "../types";
import { PaysuiteProvider } from "./paysuite.provider";

const paysuiteProvider = new PaysuiteProvider();

const providers: Record<ProviderCode, PaymentProvider> = {
  paysuite: paysuiteProvider,
  mpesa_direct: paysuiteProvider,
  emola_direct: paysuiteProvider,
  bank_direct: paysuiteProvider,
};

export function resolvePaymentProvider(provider: ProviderCode = "paysuite"): PaymentProvider {
  return providers[provider] ?? paysuiteProvider;
}
