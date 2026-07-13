import { Router, type Request, type Response } from "express";
import {
  confirmPaymentIntent,
  createPaymentIntent,
  getPaymentIntent,
} from "./paymentIntent.service";
import type { ConfirmPaymentIntentInput, CreatePaymentIntentInput } from "../types";

const router = Router();

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : "unknown_error";

  if (message === "payment_intent_not_found") return 404;
  if (message === "database_unavailable") return 503;
  if (message.startsWith("payment_provider_not_implemented:")) return 501;
  if (
    [
      "invalid_amount",
      "unsupported_currency",
      "merchant_id_required",
      "customer_phone_required",
      "payment_intent_not_confirmable",
    ].includes(message)
  ) {
    return 400;
  }

  return 500;
}

router.post("/payment_intents", async (req: Request, res: Response) => {
  try {
    const input = req.body as CreatePaymentIntentInput;
    const paymentIntent = await createPaymentIntent(input);
    return res.status(201).json({ paymentIntent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    return res.status(errorStatus(error)).json({ error: message });
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
    const message = error instanceof Error ? error.message : "internal_error";
    return res.status(errorStatus(error)).json({ error: message });
  }
});

router.post("/payment_intents/:id/confirm", async (req: Request, res: Response) => {
  try {
    const input = req.body as ConfirmPaymentIntentInput;
    const paymentIntent = await confirmPaymentIntent(req.params.id, input);
    return res.status(200).json({ paymentIntent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    return res.status(errorStatus(error)).json({ error: message });
  }
});

export default router;
