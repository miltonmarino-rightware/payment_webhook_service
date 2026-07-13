import crypto from "crypto";
import { eq } from "drizzle-orm";
import { paymentIntents, type PaymentIntentRecord } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { resolvePaymentProvider } from "../providers/provider.factory";
import type {
  ConfirmPaymentIntentInput,
  CreatePaymentIntentInput,
  PaymentIntent,
} from "../types";

function createPublicId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function toDomain(record: PaymentIntentRecord): PaymentIntent {
  return {
    id: record.id,
    amount: Number(record.amount),
    currency: record.currency as "MZN",
    merchantId: record.merchantId,
    orderReference: record.orderReference ?? undefined,
    description: record.description ?? undefined,
    status: record.status,
    paymentMethod: record.paymentMethod ?? undefined,
    provider: record.provider ?? undefined,
    providerReference: record.providerReference ?? undefined,
    clientSecret: record.clientSecret,
    metadata: (record.metadata ?? {}) as Record<string, unknown>,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function createPaymentIntent(
  input: CreatePaymentIntentInput
): Promise<PaymentIntent> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("invalid_amount");
  }

  if (input.currency !== "MZN") {
    throw new Error("unsupported_currency");
  }

  if (!input.merchantId?.trim()) {
    throw new Error("merchant_id_required");
  }

  const db = await getDb();
  if (!db) throw new Error("database_unavailable");

  const now = new Date();
  const result = await db
    .insert(paymentIntents)
    .values({
      id: createPublicId("pi"),
      merchantId: input.merchantId.trim(),
      amount: input.amount.toFixed(2),
      currency: input.currency,
      status: "requires_payment_method",
      clientSecret: createPublicId("pi_secret"),
      orderReference: input.orderReference,
      description: input.description,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!result[0]) throw new Error("payment_intent_creation_failed");
  return toDomain(result[0]);
}

export async function getPaymentIntent(id: string): Promise<PaymentIntent | null> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");

  const result = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, id))
    .limit(1);

  return result[0] ? toDomain(result[0]) : null;
}

export async function confirmPaymentIntent(
  id: string,
  input: ConfirmPaymentIntentInput
): Promise<PaymentIntent> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");

  const existing = await getPaymentIntent(id);
  if (!existing) throw new Error("payment_intent_not_found");

  if (["succeeded", "failed", "cancelled", "expired"].includes(existing.status)) {
    throw new Error("payment_intent_not_confirmable");
  }

  if (["mpesa", "emola"].includes(input.paymentMethod) && !input.customerPhone) {
    throw new Error("customer_phone_required");
  }

  const provider = resolvePaymentProvider(input.provider ?? "paysuite");
  const providerResult = await provider.createPayment({
    paymentIntent: existing,
    paymentMethod: input.paymentMethod,
    customerPhone: input.customerPhone,
  });

  if (!providerResult.success) {
    throw new Error(providerResult.error ?? "provider_payment_failed");
  }

  const updated = await db
    .update(paymentIntents)
    .set({
      status: providerResult.status,
      paymentMethod: input.paymentMethod,
      provider: provider.code,
      providerReference: providerResult.providerReference,
      providerResponse: providerResult.raw,
      updatedAt: new Date(),
    })
    .where(eq(paymentIntents.id, id))
    .returning();

  if (!updated[0]) throw new Error("payment_intent_update_failed");
  return toDomain(updated[0]);
}
