import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  json,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Payments table - tracks all payment transactions
 * Stores references to payments but NOT the actual money
 */
export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  
  // Transaction identifiers
  transactionId: varchar("transactionId", { length: 64 }).notNull().unique(),
  operatorReference: varchar("operatorReference", { length: 128 }),
  externalSystemId: varchar("externalSystemId", { length: 128 }).notNull(),
  
  // Payment details (reference only, not actual money handling)
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("MZN"),
  
  // State management
  status: mysqlEnum("status", [
    "CREATED",
    "PENDING",
    "SUCCESS",
    "FAILED",
    "EXPIRED",
    "COMPLETED",
  ])
    .notNull()
    .default("CREATED"),
  previousStatus: varchar("previousStatus", { length: 32 }),
  
  // Operator data
  operatorResponse: json("operatorResponse"),
  
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
  expiresAt: timestamp("expiresAt"),
  
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
export const transactionLogs = mysqlTable("transaction_logs", {
  id: int("id").autoincrement().primaryKey(),
  
  // Reference to payment
  paymentId: int("paymentId").notNull(),
  
  // Event details
  eventType: varchar("eventType", { length: 32 }).notNull(),
  details: json("details"),
  
  // Request metadata
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  
  // Timestamp
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TransactionLog = typeof transactionLogs.$inferSelect;
export type InsertTransactionLog = typeof transactionLogs.$inferInsert;

/**
 * Notifications table - tracks external system notifications
 * Manages retry logic and delivery status
 */
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  
  // Reference to payment
  paymentId: int("paymentId").notNull(),
  
  // External system details
  externalSystemWebhook: varchar("externalSystemWebhook", { length: 512 }).notNull(),
  
  // Delivery status
  status: mysqlEnum("status", ["PENDING", "SENT", "FAILED"]).notNull().default("PENDING"),
  
  // Response tracking
  responseStatus: int("responseStatus"),
  responseBody: text("responseBody"),
  
  // Retry management
  attemptCount: int("attemptCount").notNull().default(0),
  nextRetryAt: timestamp("nextRetryAt"),
  
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
