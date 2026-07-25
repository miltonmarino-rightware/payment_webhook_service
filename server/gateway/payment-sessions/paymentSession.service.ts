import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { paymentIntents, paymentSessions, type PaymentSessionRecord } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { confirmPaymentIntent, createPaymentIntent, getPaymentIntent } from "../payment-intents/paymentIntent.service";
import type { PaymentIntent, PaymentIntentStatus, PaymentMethodType, ProviderCode } from "../types";

export type PublicPaymentStatus = "created" | "payment_pending" | "payment_processing" | "payment_confirmed" | "payment_failed" | "payment_cancelled" | "payment_expired";

export interface CreatePaymentSessionInput {
  reference: string;
  description: string;
  product: { id: string; name: string; quantity: number; unitPrice: number };
  amount: number;
  currency: "MZN";
  customer: { name: string; email: string; phone: string; country?: string; city?: string };
  returnUrl: string;
  cancelUrl: string;
  metadata?: Record<string, unknown>;
  locale?: string;
  expiresInSeconds?: number;
}

export interface PaymentSession {
  id: string;
  paymentId: string;
  merchantId: string;
  reference: string;
  status: "active" | "completed" | "cancelled" | "expired";
  product: CreatePaymentSessionInput["product"];
  customer: CreatePaymentSessionInput["customer"];
  returnUrl: string;
  cancelUrl: string;
  locale: string;
  checkoutUrl: string;
  expiresAt: string;
  paymentIntent: PaymentIntent;
}

function publicId(prefix: string) { return `${prefix}_${crypto.randomBytes(24).toString("hex")}`; }
function baseUrl() { return (process.env.GATEWAY_PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, ""); }

export function mapPublicStatus(status: PaymentIntentStatus): PublicPaymentStatus {
  if (status === "processing") return "payment_processing";
  if (status === "succeeded") return "payment_confirmed";
  if (status === "failed") return "payment_failed";
  if (status === "cancelled") return "payment_cancelled";
  if (status === "expired") return "payment_expired";
  if (status === "requires_confirmation") return "payment_pending";
  return "created";
}

function validateUrl(value: string, field: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${field}_invalid`); }
  const localDevelopment = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) throw new Error(`${field}_https_required`);
  if (url.username || url.password) throw new Error(`${field}_invalid`);
  if (["javascript:", "data:", "file:"].includes(url.protocol)) throw new Error(`${field}_invalid`);
}

function validateInput(input: CreatePaymentSessionInput) {
  if (!input.reference || input.reference.length > 128) throw new Error("reference_invalid");
  if (!input.description || input.description.length > 500) throw new Error("description_invalid");
  if (!input.product?.id || !input.product?.name) throw new Error("product_invalid");
  if (!Number.isInteger(input.product.quantity) || input.product.quantity <= 0) throw new Error("quantity_invalid");
  if (!Number.isFinite(input.product.unitPrice) || input.product.unitPrice <= 0) throw new Error("unit_price_invalid");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("invalid_amount");
  if (Math.round(input.product.quantity * input.product.unitPrice * 100) !== Math.round(input.amount * 100)) throw new Error("payment_amount_mismatch");
  if (input.currency !== "MZN") throw new Error("unsupported_currency");
  if (!input.customer?.name || !input.customer?.email || !input.customer?.phone) throw new Error("customer_invalid");
  validateUrl(input.returnUrl, "return_url");
  validateUrl(input.cancelUrl, "cancel_url");
}

async function toDomain(record: PaymentSessionRecord): Promise<PaymentSession> {
  const intent = await getPaymentIntent(record.paymentIntentId, record.merchantId);
  if (!intent) throw new Error("payment_intent_not_found");
  return { id: record.id, paymentId: record.paymentIntentId, merchantId: record.merchantId, reference: record.reference, status: record.status, product: record.product, customer: record.customer, returnUrl: record.returnUrl, cancelUrl: record.cancelUrl, locale: record.locale, checkoutUrl: `${baseUrl()}/checkout/${record.id}`, expiresAt: record.expiresAt.toISOString(), paymentIntent: intent };
}

export async function createPaymentSession(merchantId: string, input: CreatePaymentSessionInput): Promise<PaymentSession> {
  validateInput(input);
  const db = await getDb(); if (!db) throw new Error("database_unavailable");
  const existing = await db.select().from(paymentSessions).where(and(eq(paymentSessions.merchantId, merchantId), eq(paymentSessions.reference, input.reference))).limit(1);
  if (existing[0]) return toDomain(existing[0]);
  const ttl = Math.min(Math.max(input.expiresInSeconds ?? 1800, 300), 86400);
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const intent = await createPaymentIntent(merchantId, { amount: input.amount, currency: input.currency, orderReference: input.reference, description: input.description, metadata: { ...(input.metadata ?? {}), product: input.product, customer: input.customer, paymentSession: true }, });
  await db.update(paymentIntents).set({ expiresAt }).where(eq(paymentIntents.id, intent.id));
  const inserted = await db.insert(paymentSessions).values({ id: publicId("ps"), paymentIntentId: intent.id, merchantId, reference: input.reference, product: input.product, customer: input.customer, returnUrl: input.returnUrl, cancelUrl: input.cancelUrl, locale: input.locale ?? "pt-MZ", expiresAt }).returning();
  if (!inserted[0]) throw new Error("payment_session_creation_failed");
  return toDomain(inserted[0]);
}

export async function getPaymentSession(id: string, merchantId?: string): Promise<PaymentSession | null> {
  const db = await getDb(); if (!db) throw new Error("database_unavailable");
  const where = merchantId ? and(eq(paymentSessions.id, id), eq(paymentSessions.merchantId, merchantId)) : eq(paymentSessions.id, id);
  const rows = await db.select().from(paymentSessions).where(where).limit(1);
  if (!rows[0]) return null;
  if (rows[0].status === "active" && rows[0].expiresAt.getTime() <= Date.now()) {
    const now = new Date();
    await db.transaction(async tx => { await tx.update(paymentSessions).set({ status: "expired", updatedAt: now }).where(eq(paymentSessions.id, id)); await tx.update(paymentIntents).set({ status: "expired", expiredAt: now, updatedAt: now }).where(and(eq(paymentIntents.id, rows[0].paymentIntentId), eq(paymentIntents.status, "requires_payment_method"))); });
    rows[0].status = "expired";
  }
  return toDomain(rows[0]);
}

export async function confirmHostedPaymentSession(id: string, paymentMethod: PaymentMethodType, customerPhone?: string, provider?: ProviderCode) {
  const session = await getPaymentSession(id);
  if (!session) throw new Error("payment_session_not_found");
  if (session.status !== "active") throw new Error("payment_session_not_active");
  return confirmPaymentIntent(session.paymentId, session.merchantId, { paymentMethod, customerPhone, provider });
}

export async function cancelPaymentSession(id: string) {
  const session = await getPaymentSession(id); if (!session) throw new Error("payment_session_not_found");
  if (session.paymentIntent.status === "succeeded") throw new Error("payment_session_not_cancellable");
  const db = await getDb(); if (!db) throw new Error("database_unavailable");
  const now = new Date();
  await db.transaction(async tx => { await tx.update(paymentSessions).set({ status: "cancelled", cancelledAt: now, updatedAt: now }).where(eq(paymentSessions.id, id)); await tx.update(paymentIntents).set({ status: "cancelled", cancelledAt: now, updatedAt: now }).where(eq(paymentIntents.id, session.paymentId)); });
  return { ...session, status: "cancelled" as const };
}

export async function getPaymentStatus(merchantId: string, query: { paymentId?: string; reference?: string }) {
  const db = await getDb(); if (!db) throw new Error("database_unavailable");
  let intent: PaymentIntent | null = null;
  if (query.paymentId) intent = await getPaymentIntent(query.paymentId, merchantId);
  else if (query.reference) {
    const rows = await db.select({ id: paymentIntents.id }).from(paymentIntents).where(and(eq(paymentIntents.merchantId, merchantId), eq(paymentIntents.orderReference, query.reference))).limit(1);
    if (rows[0]) intent = await getPaymentIntent(rows[0].id, merchantId);
  }
  if (!intent) return null;
  const raw = await db.select().from(paymentIntents).where(eq(paymentIntents.id, intent.id)).limit(1);
  return { paymentId: intent.id, reference: intent.orderReference, status: mapPublicStatus(intent.status), amount: intent.amount, currency: intent.currency, paidAt: raw[0]?.paidAt?.toISOString(), method: intent.paymentMethod, provider: intent.provider, providerReference: intent.providerReference };
}
