import crypto from "crypto";
import dns from "dns/promises";
import net from "net";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  merchantWebhookEndpoints,
  outboundWebhookEvents,
  paymentIntents,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { decryptJson, type EncryptedEnvelope } from "../../security/dataEncryption";

export type OutboundPaymentEventType =
  | "payment_intent.processing"
  | "payment_intent.succeeded"
  | "payment_intent.failed"
  | "payment_intent.cancelled"
  | "payment_intent.expired";

export type OutboundWebhookPayload = {
  id: string;
  type: OutboundPaymentEventType;
  createdAt: string;
  data: {
    paymentIntent: {
      id: string;
      merchantId: string;
      amount: number;
      currency: string;
      status: string;
      orderReference?: string;
      providerReference?: string;
    };
  };
};

const MAX_RESPONSE_BODY = 2048;

export function createOutboundSignature(timestamp: string, rawBody: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export function calculateBackoffSeconds(attemptNumber: number): number {
  return Math.min(3600, Math.max(5, 5 * 2 ** Math.max(0, attemptNumber - 1)));
}

export function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function isPrivateAddress(address: string): boolean {
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

export async function assertSafeWebhookUrl(value: string): Promise<URL> {
  const url = new URL(value);
  const localDevelopment = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.username || url.password) throw new Error("merchant_webhook_url_credentials_not_allowed");
  if (url.protocol !== "https:" && !localDevelopment) throw new Error("merchant_webhook_https_required");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!localDevelopment && addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("merchant_webhook_private_address_not_allowed");
  }
  return url;
}

export async function enqueuePaymentIntentEvent(paymentIntentId: string, eventType: OutboundPaymentEventType): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const rows = await db.select().from(paymentIntents).where(eq(paymentIntents.id, paymentIntentId)).limit(1);
  const paymentIntent = rows[0];
  if (!paymentIntent) throw new Error("payment_intent_not_found");
  const eventId = `evt_${crypto.randomBytes(16).toString("hex")}`;
  const payload: OutboundWebhookPayload = {
    id: eventId,
    type: eventType,
    createdAt: new Date().toISOString(),
    data: { paymentIntent: { id: paymentIntent.id, merchantId: paymentIntent.merchantId, amount: Number(paymentIntent.amount), currency: paymentIntent.currency, status: paymentIntent.status, orderReference: paymentIntent.orderReference ?? undefined, providerReference: paymentIntent.providerReference ?? undefined } },
  };
  await db.insert(outboundWebhookEvents).values({ eventId, merchantId: paymentIntent.merchantId, paymentIntentId, eventType, payload }).onConflictDoNothing();
}

async function deliverOne(eventId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");

  const claimed = await db.update(outboundWebhookEvents).set({ status: "delivering", updatedAt: new Date() }).where(
    and(eq(outboundWebhookEvents.id, eventId), inArray(outboundWebhookEvents.status, ["queued", "retrying"]))
  ).returning({ id: outboundWebhookEvents.id });
  if (!claimed[0]) return;

  const rows = await db.select({ event: outboundWebhookEvents, endpoint: merchantWebhookEndpoints }).from(outboundWebhookEvents).innerJoin(
    merchantWebhookEndpoints,
    eq(outboundWebhookEvents.merchantId, merchantWebhookEndpoints.merchantId)
  ).where(and(eq(outboundWebhookEvents.id, eventId), eq(merchantWebhookEndpoints.enabled, 1))).limit(1);

  const row = rows[0];
  if (!row) {
    await db.update(outboundWebhookEvents).set({ status: "dead_letter", lastError: "merchant_webhook_endpoint_unavailable", updatedAt: new Date() }).where(eq(outboundWebhookEvents.id, eventId));
    return;
  }

  const attempt = row.event.attemptCount + 1;
  await db.update(outboundWebhookEvents).set({ attemptCount: attempt, updatedAt: new Date() }).where(eq(outboundWebhookEvents.id, eventId));

  try {
    await assertSafeWebhookUrl(row.endpoint.url);
    const secret = decryptJson<string>(row.endpoint.secret as EncryptedEnvelope, `merchant-webhook:${row.endpoint.merchantId}`);
    const rawBody = JSON.stringify(row.event.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createOutboundSignature(timestamp, rawBody, secret);
    const response = await fetch(row.endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "GATEAWAY-Webhooks/1.0",
        "x-gateway-event-id": row.event.eventId,
        "x-gateway-timestamp": timestamp,
        "x-gateway-signature": `sha256=${signature}`,
      },
      body: rawBody,
      redirect: "error",
      signal: AbortSignal.timeout(Number(process.env.OUTBOUND_WEBHOOK_TIMEOUT_MS ?? 10000)),
    });
    const responseBody = (await response.text()).slice(0, MAX_RESPONSE_BODY);
    if (response.ok) {
      await db.update(outboundWebhookEvents).set({ status: "delivered", lastResponseStatus: response.status, lastResponseBody: responseBody, lastError: null, deliveredAt: new Date(), updatedAt: new Date() }).where(eq(outboundWebhookEvents.id, eventId));
      return;
    }
    const retryable = shouldRetryStatus(response.status);
    const exhausted = attempt >= row.event.maxAttempts;
    await db.update(outboundWebhookEvents).set({ status: retryable && !exhausted ? "retrying" : "dead_letter", nextAttemptAt: new Date(Date.now() + calculateBackoffSeconds(attempt) * 1000), lastResponseStatus: response.status, lastResponseBody: responseBody, lastError: `http_${response.status}`, updatedAt: new Date() }).where(eq(outboundWebhookEvents.id, eventId));
  } catch (error) {
    const exhausted = attempt >= row.event.maxAttempts;
    await db.update(outboundWebhookEvents).set({ status: exhausted ? "dead_letter" : "retrying", nextAttemptAt: new Date(Date.now() + calculateBackoffSeconds(attempt) * 1000), lastError: error instanceof Error ? error.message.slice(0, 512) : "delivery_failed", updatedAt: new Date() }).where(eq(outboundWebhookEvents.id, eventId));
  }
}

export async function processOutboundWebhookQueue(limit = 25): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const due = await db.select({ id: outboundWebhookEvents.id }).from(outboundWebhookEvents).where(and(inArray(outboundWebhookEvents.status, ["queued", "retrying"]), sql`${outboundWebhookEvents.nextAttemptAt} <= NOW()`)).limit(limit);
  for (const event of due) await deliverOne(event.id);
}

export function startOutboundWebhookProcessor(intervalMs = 5000): ReturnType<typeof setInterval> {
  console.log("[OutboundWebhook] Starting delivery processor");
  const timer = setInterval(() => {
    processOutboundWebhookQueue().catch((error) => console.error("[OutboundWebhook] Queue processing failed:", error));
  }, intervalMs);
  timer.unref?.();
  return timer;
}
