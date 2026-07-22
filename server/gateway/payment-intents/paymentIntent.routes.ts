import { Router, type Response } from "express";
import {
  confirmPaymentIntent,
  createPaymentIntent,
  getPaymentIntent,
} from "./paymentIntent.service";
import type { ConfirmPaymentIntentInput, CreatePaymentIntentInput } from "../types";
import {
  enforceRateLimit,
  findIdempotencyRecord,
  hashRequestBody,
  requireMerchantScope,
  storeIdempotencyRecord,
  type MerchantRequest,
} from "../security/merchantSecurity";

const router = Router();

type PublicErrorResponse = {
  status: number;
  body: {
    error: string;
    provider?: string;
  };
};

const validationErrors = new Set([
  "invalid_amount",
  "unsupported_currency",
  "merchant_id_required",
  "merchant_id_mismatch",
  "customer_phone_required",
  "payment_intent_not_confirmable",
]);

export function paymentIntentErrorResponse(error: unknown): PublicErrorResponse {
  const message = error instanceof Error ? error.message : "unknown_error";

  if (message === "payment_intent_not_found") return { status: 404, body: { error: message } };
  if (message === "database_unavailable") return { status: 503, body: { error: "service_unavailable" } };
  if (message === "idempotency_key_reused_with_different_payload") return { status: 409, body: { error: message } };
  if (message.startsWith("provider_not_configured:")) {
    const provider = message.slice("provider_not_configured:".length) || "unknown";
    return { status: 503, body: { error: "provider_not_configured", provider } };
  }
  if (message === "paysuite_api_token_missing") {
    return { status: 503, body: { error: "provider_not_configured", provider: "paysuite" } };
  }
  if (message.startsWith("payment_provider_not_implemented:")) {
    const provider = message.slice("payment_provider_not_implemented:".length) || "unknown";
    return { status: 501, body: { error: "payment_provider_not_implemented", provider } };
  }
  if (validationErrors.has(message)) return { status: 400, body: { error: message } };
  return { status: 500, body: { error: "internal_error" } };
}

function sendError(res: Response, error: unknown) {
  const response = paymentIntentErrorResponse(error);
  const internalMessage = error instanceof Error ? error.message : "unknown_error";
  if (response.status >= 500) console.error("[PaymentIntent] Request failed:", internalMessage);
  return res.status(response.status).json(response.body);
}

function idempotencyKey(req: MerchantRequest): string | null {
  const key = req.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128) return null;
  return key;
}

router.post(
  "/payment_intents",
  requireMerchantScope("payment_intents:write"),
  enforceRateLimit,
  async (req: MerchantRequest, res: Response) => {
    try {
      const key = idempotencyKey(req);
      if (!key) return res.status(400).json({ error: "idempotency_key_required" });
      const merchantId = req.merchant!.merchantId;
      const requestHash = hashRequestBody(req.body);
      const existing = await findIdempotencyRecord(merchantId, "create_payment_intent", key, requestHash);
      if (existing?.responseBody && existing.responseStatus) return res.status(existing.responseStatus).json(existing.responseBody);
      const input = req.body as CreatePaymentIntentInput;
      const paymentIntent = await createPaymentIntent(merchantId, input);
      const body = { paymentIntent };
      await storeIdempotencyRecord({ merchantId, operation: "create_payment_intent", key, requestHash, responseStatus: 201, responseBody: body, resourceId: paymentIntent.id });
      return res.status(201).json(body);
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.get(
  "/payment_intents/:id",
  requireMerchantScope("payment_intents:read"),
  enforceRateLimit,
  async (req: MerchantRequest, res: Response) => {
    try {
      const paymentIntent = await getPaymentIntent(req.params.id, req.merchant!.merchantId);
      if (!paymentIntent) return res.status(404).json({ error: "payment_intent_not_found" });
      return res.status(200).json({ paymentIntent });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.post(
  "/payment_intents/:id/confirm",
  requireMerchantScope("payment_intents:confirm"),
  enforceRateLimit,
  async (req: MerchantRequest, res: Response) => {
    try {
      const key = idempotencyKey(req);
      if (!key) return res.status(400).json({ error: "idempotency_key_required" });
      const merchantId = req.merchant!.merchantId;
      const requestHash = hashRequestBody({ id: req.params.id, body: req.body });
      const operation = `confirm_payment_intent:${req.params.id}`;
      const existing = await findIdempotencyRecord(merchantId, operation, key, requestHash);
      if (existing?.responseBody && existing.responseStatus) return res.status(existing.responseStatus).json(existing.responseBody);
      const input = req.body as ConfirmPaymentIntentInput;
      const paymentIntent = await confirmPaymentIntent(req.params.id, merchantId, input);
      const body = { paymentIntent };
      await storeIdempotencyRecord({ merchantId, operation, key, requestHash, responseStatus: 200, responseBody: body, resourceId: paymentIntent.id });
      return res.status(200).json(body);
    } catch (error) {
      return sendError(res, error);
    }
  }
);

export default router;
