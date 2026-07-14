import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
  decimal,
  jsonb,
  serial,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "CREATED",
  "PENDING",
  "SUCCESS",
  "FAILED",
  "EXPIRED",
  "COMPLETED",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "PENDING",
  "SENT",
  "FAILED",
]);

export const paymentIntentStatusEnum = pgEnum("payment_intent_status", [
  "requires_payment_method",
  "requires_confirmation",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);

export const paymentMethodTypeEnum = pgEnum("payment_method_type", [
  "mpesa",
  "emola",
  "bank",
  "card",
]);

export const providerCodeEnum = pgEnum("provider_code", [
  "paysuite",
  "mpesa_direct",
  "emola_direct",
  "bank_direct",
]);

export const providerWebhookProcessingStatusEnum = pgEnum(
  "provider_webhook_processing_status",
  ["received", "processed", "ignored", "failed"]
);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: false }).defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: false }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  transactionId: varchar("transactionId", { length: 64 }).notNull().unique(),
  operatorReference: varchar("operatorReference", { length: 128 }),
  externalSystemId: varchar("externalSystemId", { length: 128 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("MZN"),
  status: paymentStatusEnum("status").notNull().default("CREATED"),
  previousStatus: varchar("previousStatus", { length: 32 }),
  operatorResponse: jsonb("operatorResponse"),
  createdAt: timestamp("createdAt", { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: false }).defaultNow().notNull(),
  completedAt: timestamp("completedAt", { withTimezone: false }),
  expiresAt: timestamp("expiresAt", { withTimezone: false }),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
});

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

export const paymentIntents = pgTable("payment_intents", {
  id: varchar("id", { length: 64 }).primaryKey(),
  merchantId: varchar("merchantId", { length: 128 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("MZN"),
  status: paymentIntentStatusEnum("status").notNull().default("requires_payment_method"),
  paymentMethod: paymentMethodTypeEnum("paymentMethod"),
  provider: providerCodeEnum("provider"),
  providerReference: varchar("providerReference", { length: 128 }),
  clientSecret: varchar("clientSecret", { length: 128 }).notNull().unique(),
  orderReference: varchar("orderReference", { length: 128 }),
  description: text("description"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  providerResponse: jsonb("providerResponse"),
  createdAt: timestamp("createdAt", { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: false }).defaultNow().notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: false }),
});

export type PaymentIntentRecord = typeof paymentIntents.$inferSelect;
export type InsertPaymentIntent = typeof paymentIntents.$inferInsert;

export const providerWebhookEvents = pgTable("provider_webhook_events", {
  id: serial("id").primaryKey(),
  provider: providerCodeEnum("provider").notNull(),
  requestId: varchar("requestId", { length: 128 }).notNull().unique(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  providerReference: varchar("providerReference", { length: 128 }),
  signature: varchar("signature", { length: 256 }),
  accountId: varchar("accountId", { length: 128 }),
  payload: jsonb("payload").notNull(),
  processingStatus: providerWebhookProcessingStatusEnum("processingStatus")
    .notNull()
    .default("received"),
  errorMessage: text("errorMessage"),
  receivedAt: timestamp("receivedAt", { withTimezone: false }).defaultNow().notNull(),
  processedAt: timestamp("processedAt", { withTimezone: false }),
});

export type ProviderWebhookEvent = typeof providerWebhookEvents.$inferSelect;
export type InsertProviderWebhookEvent = typeof providerWebhookEvents.$inferInsert;

export const transactionLogs = pgTable("transaction_logs", {
  id: serial("id").primaryKey(),
  paymentId: integer("paymentId").notNull(),
  eventType: varchar("eventType", { length: 32 }).notNull(),
  details: jsonb("details"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt", { withTimezone: false }).defaultNow().notNull(),
});

export type TransactionLog = typeof transactionLogs.$inferSelect;
export type InsertTransactionLog = typeof transactionLogs.$inferInsert;

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  paymentId: integer("paymentId").notNull(),
  externalSystemWebhook: varchar("externalSystemWebhook", { length: 512 }).notNull(),
  status: notificationStatusEnum("status").notNull().default("PENDING"),
  responseStatus: integer("responseStatus"),
  responseBody: text("responseBody"),
  attemptCount: integer("attemptCount").notNull().default(0),
  nextRetryAt: timestamp("nextRetryAt", { withTimezone: false }),
  createdAt: timestamp("createdAt", { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: false }).defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
