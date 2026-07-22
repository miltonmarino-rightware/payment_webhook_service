import { and, eq } from "drizzle-orm";
import {
  paymentIntents,
  providerWebhookEvents,
  type PaymentIntentRecord,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { encryptJson, sha256Hex } from "../../security/dataEncryption";
import type { PaymentIntentStatus } from "../types";

export type PaysuiteWebhookPayload = {
  event?: string;
  data?: {
    id?: string;
    reference?: string;
    amount?: number;
    transaction?: {
      id?: string;
      method?: string;
      paid_at?: string;
    };
  };
  created_at?: number;
  request_id?: string;
};

export type PaysuiteWebhookResult = {
  duplicate: boolean;
  ignored: boolean;
  paymentIntentId?: string;
  status?: PaymentIntentStatus;
};

function mapEventToStatus(eventType: string): PaymentIntentStatus | null {
  switch (eventType) {
    case "payment.success":
      return "succeeded";
    case "payment.failed":
      return "failed";
    default:
      return null;
  }
}

function validatePayload(payload: PaysuiteWebhookPayload): asserts payload is PaysuiteWebhookPayload & {
  event: string;
  request_id: string;
  data: { id: string; reference?: string };
} {
  if (!payload || typeof payload !== "object") {
    throw new Error("paysuite_webhook_invalid_payload");
  }
  if (!payload.event || typeof payload.event !== "string") {
    throw new Error("paysuite_webhook_event_required");
  }
  if (!payload.request_id || typeof payload.request_id !== "string") {
    throw new Error("paysuite_webhook_request_id_required");
  }
  if (!payload.data?.id || typeof payload.data.id !== "string") {
    throw new Error("paysuite_webhook_payment_id_required");
  }
}

function mergeProviderResponse(
  current: unknown,
  encryptedWebhook: ReturnType<typeof encryptJson>
): Record<string, unknown> {
  const currentObject =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};

  return {
    ...currentObject,
    webhook: encryptedWebhook,
  };
}

async function findPaymentIntent(
  providerReference: string,
  orderReference?: string
): Promise<PaymentIntentRecord | null> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");

  const byProviderReference = await db
    .select()
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.provider, "paysuite"),
        eq(paymentIntents.providerReference, providerReference)
      )
    )
    .limit(1);

  if (byProviderReference[0]) return byProviderReference[0];
  if (!orderReference) return null;

  const byOrderReference = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.orderReference, orderReference))
    .limit(1);

  return byOrderReference[0] ?? null;
}

export async function processPaysuiteWebhook(
  payload: PaysuiteWebhookPayload,
  context: { signature?: string; accountId?: string }
): Promise<PaysuiteWebhookResult> {
  validatePayload(payload);

  const db = await getDb();
  if (!db) throw new Error("database_unavailable");

  const existingEvent = await db
    .select({ id: providerWebhookEvents.id })
    .from(providerWebhookEvents)
    .where(eq(providerWebhookEvents.requestId, payload.request_id))
    .limit(1);

  if (existingEvent[0]) {
    return { duplicate: true, ignored: false };
  }

  const encryptionContext = `paysuite:${payload.request_id}`;
  const encryptedPayload = encryptJson(payload, encryptionContext);
  const signatureFingerprint = context.signature
    ? sha256Hex(context.signature)
    : undefined;

  const inserted = await db
    .insert(providerWebhookEvents)
    .values({
      provider: "paysuite",
      requestId: payload.request_id,
      eventType: payload.event,
      providerReference: payload.data.id,
      signature: signatureFingerprint,
      accountId: context.accountId,
      payload: encryptedPayload,
      processingStatus: "received",
    })
    .returning({ id: providerWebhookEvents.id });

  const webhookEventId = inserted[0]?.id;
  if (!webhookEventId) throw new Error("paysuite_webhook_event_creation_failed");

  try {
    const nextStatus = mapEventToStatus(payload.event);
    if (!nextStatus) {
      await db
        .update(providerWebhookEvents)
        .set({ processingStatus: "ignored", processedAt: new Date() })
        .where(eq(providerWebhookEvents.id, webhookEventId));

      return { duplicate: false, ignored: true };
    }

    const paymentIntent = await findPaymentIntent(payload.data.id, payload.data.reference);
    if (!paymentIntent) {
      await db
        .update(providerWebhookEvents)
        .set({
          processingStatus: "failed",
          errorMessage: "payment_intent_not_found",
          processedAt: new Date(),
        })
        .where(eq(providerWebhookEvents.id, webhookEventId));

      throw new Error("payment_intent_not_found");
    }

    await db
      .update(paymentIntents)
      .set({
        status: nextStatus,
        providerResponse: mergeProviderResponse(
          paymentIntent.providerResponse,
          encryptedPayload
        ),
        updatedAt: new Date(),
      })
      .where(eq(paymentIntents.id, paymentIntent.id));

    await db
      .update(providerWebhookEvents)
      .set({ processingStatus: "processed", processedAt: new Date() })
      .where(eq(providerWebhookEvents.id, webhookEventId));

    return {
      duplicate: false,
      ignored: false,
      paymentIntentId: paymentIntent.id,
      status: nextStatus,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";

    await db
      .update(providerWebhookEvents)
      .set({
        processingStatus: "failed",
        errorMessage: message,
        processedAt: new Date(),
      })
      .where(eq(providerWebhookEvents.id, webhookEventId));

    throw error;
  }
}
