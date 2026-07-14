import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import {
  processPaysuiteWebhook,
  type PaysuiteWebhookPayload,
} from "./paysuiteWebhook.service";

const router = Router();

type RequestWithRawBody = Request & { rawBody?: Buffer };

function normalizeSignature(signature: string): string {
  return signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
}

function verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = normalizeSignature(signature).toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(received)) return false;

  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : "internal_error";

  if (message === "paysuite_webhook_secret_missing") return 503;
  if (message === "paysuite_webhook_signature_missing") return 401;
  if (message === "paysuite_webhook_invalid_signature") return 401;
  if (message === "payment_intent_not_found") return 404;
  if (message === "database_unavailable") return 503;
  if (message.startsWith("paysuite_webhook_")) return 400;

  return 500;
}

router.post("/paysuite", async (req: RequestWithRawBody, res: Response) => {
  try {
    const secret = process.env.PAYSUITE_WEBHOOK_SECRET;
    if (!secret) throw new Error("paysuite_webhook_secret_missing");

    const signature = req.get("x-webhook-signature");
    if (!signature) throw new Error("paysuite_webhook_signature_missing");

    const rawBody = req.rawBody;
    if (!rawBody || !verifySignature(rawBody, signature, secret)) {
      throw new Error("paysuite_webhook_invalid_signature");
    }

    const result = await processPaysuiteWebhook(req.body as PaysuiteWebhookPayload, {
      signature,
      accountId: req.get("x-account-id") ?? undefined,
    });

    return res.status(200).json({ received: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    return res.status(errorStatus(error)).json({ received: false, error: message });
  }
});

export default router;
