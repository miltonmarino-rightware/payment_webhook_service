import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import {
  merchants,
  paymentIntents,
  paymentSessions,
  type MerchantBranding,
  type MerchantCheckoutConfig,
  type PaymentSessionItem,
  type PaymentSessionRecord,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import {
  confirmPaymentIntent,
  createPaymentIntent,
  getPaymentIntent,
} from "../payment-intents/paymentIntent.service";
import type {
  PaymentIntent,
  PaymentIntentStatus,
  PaymentMethodType,
  ProviderCode,
} from "../types";

export type PublicPaymentStatus =
  | "created"
  | "payment_pending"
  | "payment_processing"
  | "payment_confirmed"
  | "payment_failed"
  | "payment_cancelled"
  | "payment_expired";

export interface CreatePaymentSessionInput {
  reference: string;
  description: string;
  items: PaymentSessionItem[];
  amount: number;
  currency: "MZN";
  customer: {
    name: string;
    email: string;
    phone: string;
    country?: string;
    city?: string;
  };
  returnUrl: string;
  cancelUrl: string;
  metadata?: Record<string, unknown>;
  locale?: string;
  expiresInSeconds?: number;
}

export interface PaymentSessionMerchant {
  id: string;
  name: string;
  branding: MerchantBranding;
  checkoutConfig: MerchantCheckoutConfig;
}

export interface PaymentSession {
  id: string;
  paymentId: string;
  merchantId: string;
  merchant: PaymentSessionMerchant;
  reference: string;
  status: "active" | "completed" | "cancelled" | "expired";
  items: PaymentSessionItem[];
  customer: CreatePaymentSessionInput["customer"];
  returnUrl: string;
  cancelUrl: string;
  locale: string;
  checkoutUrl: string;
  expiresAt: string;
  paymentIntent: PaymentIntent;
}

function publicId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}

function baseUrl(): string {
  return (
    process.env.GATEWAY_PUBLIC_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`
  ).replace(/\/$/, "");
}

export function mapPublicStatus(status: PaymentIntentStatus): PublicPaymentStatus {
  if (status === "processing") return "payment_processing";
  if (status === "succeeded") return "payment_confirmed";
  if (status === "failed") return "payment_failed";
  if (status === "cancelled") return "payment_cancelled";
  if (status === "expired") return "payment_expired";
  if (status === "requires_confirmation") return "payment_pending";
  return "created";
}

export function calculateItemsTotal(items: PaymentSessionItem[]): number {
  return items.reduce((total, item) => total + item.quantity * item.unitPrice, 0);
}

function validateRedirectUrl(
  value: string,
  field: "return_url" | "cancel_url",
  allowedOrigins: string[]
): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field}_invalid`);
  }

  if (url.username || url.password) throw new Error(`${field}_invalid`);
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);

  if (url.protocol !== "https:" && !localDevelopment) {
    throw new Error(`${field}_https_required`);
  }

  if (process.env.NODE_ENV === "production") {
    const normalizedAllowed = allowedOrigins.map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return "";
      }
    });
    if (!normalizedAllowed.includes(url.origin)) {
      throw new Error(`${field}_origin_not_allowed`);
    }
  }
}

function validateInput(
  input: CreatePaymentSessionInput,
  allowedOrigins: string[]
): void {
  if (!input.reference || input.reference.length > 128) {
    throw new Error("reference_invalid");
  }
  if (!input.description || input.description.length > 500) {
    throw new Error("description_invalid");
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
    throw new Error("items_invalid");
  }

  for (const item of input.items) {
    if (!item?.id || !item?.name || item.id.length > 128 || item.name.length > 240) {
      throw new Error("item_invalid");
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 10000) {
      throw new Error("quantity_invalid");
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
      throw new Error("unit_price_invalid");
    }
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("invalid_amount");
  }
  if (
    Math.round(calculateItemsTotal(input.items) * 100) !==
    Math.round(input.amount * 100)
  ) {
    throw new Error("payment_amount_mismatch");
  }
  if (input.currency !== "MZN") throw new Error("unsupported_currency");
  if (!input.customer?.name || !input.customer?.email || !input.customer?.phone) {
    throw new Error("customer_invalid");
  }

  validateRedirectUrl(input.returnUrl, "return_url", allowedOrigins);
  validateRedirectUrl(input.cancelUrl, "cancel_url", allowedOrigins);
}

async function getMerchant(merchantId: string): Promise<PaymentSessionMerchant & { allowedRedirectOrigins: string[] }> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const rows = await db
    .select()
    .from(merchants)
    .where(and(eq(merchants.id, merchantId), eq(merchants.status, "active")))
    .limit(1);
  const merchant = rows[0];
  if (!merchant) throw new Error("merchant_not_found");
  return {
    id: merchant.id,
    name: merchant.name,
    branding: merchant.branding ?? {},
    checkoutConfig: merchant.checkoutConfig ?? {},
    allowedRedirectOrigins: merchant.allowedRedirectOrigins ?? [],
  };
}

async function toDomain(record: PaymentSessionRecord): Promise<PaymentSession> {
  const [intent, merchant] = await Promise.all([
    getPaymentIntent(record.paymentIntentId, record.merchantId),
    getMerchant(record.merchantId),
  ]);
  if (!intent) throw new Error("payment_intent_not_found");
  return {
    id: record.id,
    paymentId: record.paymentIntentId,
    merchantId: record.merchantId,
    merchant: {
      id: merchant.id,
      name: merchant.name,
      branding: merchant.branding,
      checkoutConfig: merchant.checkoutConfig,
    },
    reference: record.reference,
    status: record.status,
    items: record.items,
    customer: record.customer,
    returnUrl: record.returnUrl,
    cancelUrl: record.cancelUrl,
    locale: record.locale,
    checkoutUrl: `${baseUrl()}/checkout/${record.id}`,
    expiresAt: record.expiresAt.toISOString(),
    paymentIntent: intent,
  };
}

export async function createPaymentSession(
  merchantId: string,
  input: CreatePaymentSessionInput
): Promise<PaymentSession> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const merchant = await getMerchant(merchantId);
  validateInput(input, merchant.allowedRedirectOrigins);

  const existing = await db
    .select()
    .from(paymentSessions)
    .where(
      and(
        eq(paymentSessions.merchantId, merchantId),
        eq(paymentSessions.reference, input.reference)
      )
    )
    .limit(1);
  if (existing[0]) return toDomain(existing[0]);

  const configuredTtl = merchant.checkoutConfig.defaultSessionTtlSeconds ?? 1800;
  const ttl = Math.min(
    Math.max(input.expiresInSeconds ?? configuredTtl, 300),
    86400
  );
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const locale = input.locale ?? merchant.checkoutConfig.defaultLocale ?? "pt-MZ";

  const intent = await createPaymentIntent(merchantId, {
    amount: input.amount,
    currency: input.currency,
    orderReference: input.reference,
    description: input.description,
    metadata: {
      ...(input.metadata ?? {}),
      items: input.items,
      customer: input.customer,
      paymentSession: true,
    },
  });

  await db
    .update(paymentIntents)
    .set({ expiresAt })
    .where(eq(paymentIntents.id, intent.id));

  const inserted = await db
    .insert(paymentSessions)
    .values({
      id: publicId("ps"),
      paymentIntentId: intent.id,
      merchantId,
      reference: input.reference,
      items: input.items,
      customer: input.customer,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      locale,
      expiresAt,
    })
    .returning();

  if (!inserted[0]) throw new Error("payment_session_creation_failed");
  return toDomain(inserted[0]);
}

export async function getPaymentSession(
  id: string,
  merchantId?: string
): Promise<PaymentSession | null> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const where = merchantId
    ? and(eq(paymentSessions.id, id), eq(paymentSessions.merchantId, merchantId))
    : eq(paymentSessions.id, id);
  const rows = await db.select().from(paymentSessions).where(where).limit(1);
  if (!rows[0]) return null;

  if (rows[0].status === "active" && rows[0].expiresAt.getTime() <= Date.now()) {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(paymentSessions)
        .set({ status: "expired", updatedAt: now })
        .where(eq(paymentSessions.id, id));
      await tx
        .update(paymentIntents)
        .set({ status: "expired", expiredAt: now, updatedAt: now })
        .where(
          and(
            eq(paymentIntents.id, rows[0].paymentIntentId),
            eq(paymentIntents.status, "requires_payment_method")
          )
        );
    });
    rows[0].status = "expired";
  }
  return toDomain(rows[0]);
}

export async function confirmHostedPaymentSession(
  id: string,
  paymentMethod: PaymentMethodType,
  customerPhone?: string,
  provider?: ProviderCode
): Promise<PaymentIntent> {
  const session = await getPaymentSession(id);
  if (!session) throw new Error("payment_session_not_found");
  if (session.status !== "active") throw new Error("payment_session_not_active");
  const allowed = session.merchant.checkoutConfig.allowedPaymentMethods ?? ["mpesa", "emola"];
  if (!allowed.includes(paymentMethod)) throw new Error("payment_method_not_allowed");
  return confirmPaymentIntent(session.paymentId, session.merchantId, {
    paymentMethod,
    customerPhone,
    provider,
  });
}

export async function cancelPaymentSession(id: string): Promise<PaymentSession> {
  const session = await getPaymentSession(id);
  if (!session) throw new Error("payment_session_not_found");
  if (session.paymentIntent.status === "succeeded") {
    throw new Error("payment_session_not_cancellable");
  }
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(paymentSessions)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(and(eq(paymentSessions.id, id), eq(paymentSessions.status, "active")));
    await tx
      .update(paymentIntents)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(
        and(
          eq(paymentIntents.id, session.paymentId),
          eq(paymentIntents.status, "requires_payment_method")
        )
      );
  });
  return (await getPaymentSession(id))!;
}

export async function getPaymentStatus(
  merchantId: string,
  query: { paymentId?: string; reference?: string }
) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  let intent: PaymentIntent | null = null;
  if (query.paymentId) {
    intent = await getPaymentIntent(query.paymentId, merchantId);
  } else if (query.reference) {
    const rows = await db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.merchantId, merchantId),
          eq(paymentIntents.orderReference, query.reference)
        )
      )
      .limit(1);
    if (rows[0]) intent = await getPaymentIntent(rows[0].id, merchantId);
  }
  if (!intent) return null;
  const raw = await db
    .select()
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.id, intent.id),
        eq(paymentIntents.merchantId, merchantId)
      )
    )
    .limit(1);
  return {
    paymentId: intent.id,
    reference: intent.orderReference,
    status: mapPublicStatus(intent.status),
    amount: intent.amount,
    currency: intent.currency,
    paidAt: raw[0]?.paidAt?.toISOString(),
    method: intent.paymentMethod,
    provider: intent.provider,
    providerReference: intent.providerReference,
  };
}