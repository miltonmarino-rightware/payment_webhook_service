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

function errorResponse(error: unknown): {
  status: number;
  body: { received: false; error: string };
} {
  const message = error instanceof Error ? error.message : "internal_error";

  if (message === "paysuite_webhook_secret_missing") {
    return { status: 503, body: { received: false, error: "webhook_not_configured" } };
  }
  if (
    message === "data_encryption_key_missing" ||
    message === "data_encryption_key_invalid"
  ) {
    return {
      status: 503,
      body: { received: false, error: "security_configuration_unavailable" },
    };
  }
  if (message === "paysuite_webhook_signature_missing") {
    return { status: 401, body: { received: false, error: "signature_required" } };
  }
  if (message === "paysuite_webhook_invalid_signature") {
    return { status: 401, body: { received: false, error: "invalid_signature" } };
  }
  if (message === "payment_intent_not_found") {
    return { status: 404, body: { received: false, error: message } };
  }
  if (message === "database_unavailable") {
    return { status: 503, body: { received: false, error: "service_unavailable" } };
  }
  if (message.startsWith("paysuite_webhook_")) {
    return { status: 400, body: { received: false, error: message } };
  }

  return { status: 500, body: { received: false, error: "internal_error" } };
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
    const internalMessage = error instanceof Error ? error.message : "unknown_error";
    const response = errorResponse(error);

    if (response.status >= 500) {
      console.error("[PaysuiteWebhook] Request failed:", internalMessage);
    }

    return res.status(response.status).json(response.body);
  }
});

export default router;
