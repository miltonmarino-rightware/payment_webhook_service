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

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */

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

/**
 * Payments table - tracks all payment transactions
 * Stores references to payments but NOT the actual money
 */
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),

  // Transaction identifiers
  transactionId: varchar("transactionId", { length: 64 }).notNull().unique(),
  operatorReference: varchar("operatorReference", { length: 128 }),
  externalSystemId: varchar("externalSystemId", { length: 128 }).notNull(),

  // Payment details (reference only, not actual money handling)
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("MZN"),

  // State management
  status: paymentStatusEnum("status").notNull().default("CREATED"),
  previousStatus: varchar("previousStatus", { length: 32 }),

  // Operator data
  operatorResponse: jsonb("operatorResponse"),

  // Timestamps
  createdAt: timestamp("createdAt", { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: false }).defaultNow().notNull(),
  completedAt: timestamp("completedAt", { withTimezone: false }),
  expiresAt: timestamp("expiresAt", { withTimezone: false }),

  // Metadata
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
});

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

/**
 * Transaction logs table - immutable audit trail
 * Every event is logged for compliance and debugging
 */
export const transactionLogs = pgTable("transaction_logs", {
  id: serial("id").primaryKey(),

  // Reference to payment
  paymentId: integer("paymentId").notNull(),

  // Event details
  eventType: varchar("eventType", { length: 32 }).notNull(),
  details: jsonb("details"),

  // Request metadata
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),

  // Timestamp
  createdAt: timestamp("createdAt", { withTimezone: false }).defaultNow().notNull(),
});

export type TransactionLog = typeof transactionLogs.$inferSelect;
export type InsertTransactionLog = typeof transactionLogs.$inferInsert;

/**
 * Notifications table - tracks external system notifications
 * Manages retry logic and delivery status
 */
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),

  // Reference to payment
  paymentId: integer("paymentId").notNull(),

  // External system details
  externalSystemWebhook: varchar("externalSystemWebhook", { length: 512 }).notNull(),

  // Delivery status
  status: notificationStatusEnum("status").notNull().default("PENDING"),

  // Response tracking
  responseStatus: integer("responseStatus"),
  responseBody: text("responseBody"),

  // Retry management
  attemptCount: integer("attemptCount").notNull().default(0),
  nextRetryAt: timestamp("nextRetryAt", { withTimezone: false }),

  // Timestamps
  createdAt: timestamp("createdAt", { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: false }).defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
