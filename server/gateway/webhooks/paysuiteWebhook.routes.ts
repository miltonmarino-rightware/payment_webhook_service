import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import {
  processPaysuiteWebhook,
  type PaysuiteWebhookPayload,
} from "./paysuiteWebhook.service";

const router = Router();
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export type RequestWithRawBody = Request & { rawBody?: Buffer };

function normalizeSignature(signature: string): string {
  return signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
}

export function parseWebhookTimestamp(timestamp: string, nowMs = Date.now()): number {
  if (!/^\d{10,13}$/.test(timestamp)) {
    throw new Error("paysuite_webhook_timestamp_invalid");
  }

  const parsed = Number(timestamp);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("paysuite_webhook_timestamp_invalid");
  }

  const timestampMs = timestamp.length === 10 ? parsed * 1000 : parsed;
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    throw new Error("paysuite_webhook_timestamp_invalid");
  }

  const toleranceSeconds = Number(
    process.env.PAYSUITE_WEBHOOK_TOLERANCE_SECONDS ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS
  );
  const safeToleranceSeconds =
    Number.isFinite(toleranceSeconds) && toleranceSeconds > 0
      ? toleranceSeconds
      : DEFAULT_WEBHOOK_TOLERANCE_SECONDS;

  const ageMs = Math.abs(nowMs - timestampMs);
  if (ageMs > safeToleranceSeconds * 1000) {
    throw new Error("paysuite_webhook_timestamp_expired");
  }

  return timestampMs;
}

export function createSignedWebhookMessage(timestamp: string, rawBody: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), rawBody]);
}

export function verifySignature(
  rawBody: Buffer,
  timestamp: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(createSignedWebhookMessage(timestamp, rawBody))
    .digest("hex");
  const received = normalizeSignature(signature).toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(received)) return false;

  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

export function errorResponse(error: unknown): {
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
  if (message === "paysuite_webhook_timestamp_missing") {
    return { status: 401, body: { received: false, error: "timestamp_required" } };
  }
  if (
    message === "paysuite_webhook_timestamp_invalid" ||
    message === "paysuite_webhook_timestamp_expired"
  ) {
    return { status: 401, body: { received: false, error: "invalid_timestamp" } };
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

    const timestamp = req.get("x-webhook-timestamp");
    if (!timestamp) throw new Error("paysuite_webhook_timestamp_missing");
    parseWebhookTimestamp(timestamp);

    const rawBody = req.rawBody;
    if (!rawBody || !verifySignature(rawBody, timestamp, signature, secret)) {
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
