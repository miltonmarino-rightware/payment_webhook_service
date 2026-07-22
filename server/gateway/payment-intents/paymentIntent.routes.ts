import { Router, type Request, type Response } from "express";
import {
  confirmPaymentIntent,
  createPaymentIntent,
  getPaymentIntent,
} from "./paymentIntent.service";
import type { ConfirmPaymentIntentInput, CreatePaymentIntentInput } from "../types";

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
  "customer_phone_required",
  "payment_intent_not_confirmable",
]);

export function paymentIntentErrorResponse(error: unknown): PublicErrorResponse {
  const message = error instanceof Error ? error.message : "unknown_error";

  if (message === "payment_intent_not_found") {
    return { status: 404, body: { error: message } };
  }

  if (message === "database_unavailable") {
    return { status: 503, body: { error: "service_unavailable" } };
  }

  if (message.startsWith("provider_not_configured:")) {
    const provider = message.slice("provider_not_configured:".length) || "unknown";
    return {
      status: 503,
      body: { error: "provider_not_configured", provider },
    };
  }

  // Backward-compatible sanitization for older provider implementations.
  if (message === "paysuite_api_token_missing") {
    return {
      status: 503,
      body: { error: "provider_not_configured", provider: "paysuite" },
    };
  }

  if (message.startsWith("payment_provider_not_implemented:")) {
    const provider = message.slice("payment_provider_not_implemented:".length) || "unknown";
    return {
      status: 501,
      body: { error: "payment_provider_not_implemented", provider },
    };
  }

  if (validationErrors.has(message)) {
    return { status: 400, body: { error: message } };
  }

  return { status: 500, body: { error: "internal_error" } };
}

function sendError(res: Response, error: unknown) {
  const response = paymentIntentErrorResponse(error);
  const internalMessage = error instanceof Error ? error.message : "unknown_error";

  if (response.status >= 500) {
    console.error("[PaymentIntent] Request failed:", internalMessage);
  }

  return res.status(response.status).json(response.body);
}

router.post("/payment_intents", async (req: Request, res: Response) => {
  try {
    const input = req.body as CreatePaymentIntentInput;
    const paymentIntent = await createPaymentIntent(input);
    return res.status(201).json({ paymentIntent });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/payment_intents/:id", async (req: Request, res: Response) => {
  try {
    const paymentIntent = await getPaymentIntent(req.params.id);
    if (!paymentIntent) {
      return res.status(404).json({ error: "payment_intent_not_found" });
    }

    return res.status(200).json({ paymentIntent });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/payment_intents/:id/confirm", async (req: Request, res: Response) => {
  try {
    const input = req.body as ConfirmPaymentIntentInput;
    const paymentIntent = await confirmPaymentIntent(req.params.id, input);
    return res.status(200).json({ paymentIntent });
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
