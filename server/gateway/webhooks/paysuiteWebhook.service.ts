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
    currency?: string;
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

const ALLOWED_TRANSITIONS: Record<PaymentIntentStatus, ReadonlySet<PaymentIntentStatus>> = {
  requires_payment_method: new Set(),
  requires_confirmation: new Set(["processing", "failed", "cancelled"]),
  processing: new Set(["succeeded", "failed", "cancelled", "expired"]),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  expired: new Set(),
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
  data: { id: string; reference?: string; amount?: number; currency?: string };
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

function toMinorUnits(value: number | string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) throw new Error("paysuite_webhook_amount_invalid");
  return Math.round((numeric + Number.EPSILON) * 100);
}

export function assertFinancialMatch(
  paymentIntent: Pick<
    PaymentIntentRecord,
    "amount" | "currency" | "orderReference" | "provider" | "providerReference"
  >,
  payload: PaysuiteWebhookPayload & {
    data: { id: string; reference?: string; amount?: number; currency?: string };
  }
): void {
  if (paymentIntent.provider !== "paysuite") {
    throw new Error("paysuite_webhook_provider_mismatch");
  }
  if (!paymentIntent.providerReference || paymentIntent.providerReference !== payload.data.id) {
    throw new Error("paysuite_webhook_provider_reference_mismatch");
  }
  if (typeof payload.data.amount !== "number") {
    throw new Error("paysuite_webhook_amount_required");
  }
  if (toMinorUnits(paymentIntent.amount) !== toMinorUnits(payload.data.amount)) {
    throw new Error("paysuite_webhook_amount_mismatch");
  }
  if (!payload.data.currency || typeof payload.data.currency !== "string") {
    throw new Error("paysuite_webhook_currency_required");
  }
  if (paymentIntent.currency.toUpperCase() !== payload.data.currency.toUpperCase()) {
    throw new Error("paysuite_webhook_currency_mismatch");
  }
  if (paymentIntent.orderReference) {
    if (!payload.data.reference) {
      throw new Error("paysuite_webhook_reference_required");
    }
    if (paymentIntent.orderReference !== payload.data.reference) {
      throw new Error("paysuite_webhook_reference_mismatch");
    }
  }
}

export function assertPaymentIntentTransition(
  currentStatus: PaymentIntentStatus,
  nextStatus: PaymentIntentStatus
): void {
  if (currentStatus === nextStatus) return;
  if (!ALLOWED_TRANSITIONS[currentStatus]?.has(nextStatus)) {
    throw new Error("payment_intent_transition_not_allowed");
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

export async function processPaysuiteWebhook(
  payload: PaysuiteWebhookPayload,
  context: { signature?: string; accountId?: string }
): Promise<PaysuiteWebhookResult> {
  validatePayload(payload);

  const db = await getDb();
  if (!db) throw new Error("database_unavailable");

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
    .onConflictDoNothing({ target: providerWebhookEvents.requestId })
    .returning({ id: providerWebhookEvents.id });

  const webhookEventId = inserted[0]?.id;
  if (!webhookEventId) {
    return { duplicate: true, ignored: false };
  }

  try {
    const nextStatus = mapEventToStatus(payload.event);
    if (!nextStatus) {
      await db
        .update(providerWebhookEvents)
        .set({ processingStatus: "ignored", processedAt: new Date() })
        .where(eq(providerWebhookEvents.id, webhookEventId));

      return { duplicate: false, ignored: true };
    }

    const result = await db.transaction(async (tx) => {
      const matched = await tx
        .select()
        .from(paymentIntents)
        .where(
          and(
            eq(paymentIntents.provider, "paysuite"),
            eq(paymentIntents.providerReference, payload.data.id)
          )
        )
        .limit(1);

      const paymentIntent = matched[0];
      if (!paymentIntent) throw new Error("payment_intent_not_found");

      assertFinancialMatch(paymentIntent, payload);
      assertPaymentIntentTransition(paymentIntent.status, nextStatus);

      const updated = await tx
        .update(paymentIntents)
        .set({
          status: nextStatus,
          providerResponse: mergeProviderResponse(
            paymentIntent.providerResponse,
            encryptedPayload
          ),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(paymentIntents.id, paymentIntent.id),
            eq(paymentIntents.status, paymentIntent.status)
          )
        )
        .returning({ id: paymentIntents.id });

      if (!updated[0]) throw new Error("payment_intent_concurrent_update");

      await tx
        .update(providerWebhookEvents)
        .set({ processingStatus: "processed", processedAt: new Date() })
        .where(eq(providerWebhookEvents.id, webhookEventId));

      return paymentIntent.id;
    });

    return {
      duplicate: false,
      ignored: false,
      paymentIntentId: result,
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
