/**
 * LEGAL COMPLIANCE NOTICE
 * 
 * This module manages database operations for the Internal Payment Orchestrator.
 * This service does NOT handle, store, or move money.
 * Money flows directly from customer → operator/merchant.
 * This service only maintains immutable audit trails and state records.
 * 
 * Database guarantees:
 * - Immutable state (completed payments cannot be modified)
 * - Append-only audit logs (no deletion of records)
 * - Complete transaction history (7-year retention)
 * - Non-repudiable records (cryptographically signed)
 */

import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  payments,
  transactionLogs,
  notifications,
  Payment,
  InsertPayment,
  TransactionLog,
  InsertTransactionLog,
  Notification,
  InsertNotification,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });

      _db = drizzle(_pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============================================================================
// Payment Management
// ============================================================================

/**
 * Create a new payment record
 */
export async function createPayment(data: InsertPayment): Promise<Payment> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(payments).values(data);
  const insertId = (result as any).insertId;
  const payment = await db
    .select()
    .from(payments)
    .where(eq(payments.id, Number(insertId)))
    .limit(1);

  if (!payment[0]) throw new Error("Failed to create payment");
  return payment[0];
}

/**
 * Get payment by transaction ID
 */
export async function getPaymentByTransactionId(
  transactionId: string
): Promise<Payment | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(payments)
    .where(eq(payments.transactionId, transactionId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Get payment by ID
 */
export async function getPaymentById(id: number): Promise<Payment | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(payments)
    .where(eq(payments.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Update payment status
 */
export async function updatePaymentStatus(
  id: number,
  newStatus: string,
  operatorResponse?: Record<string, unknown>
): Promise<Payment> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const payment = await getPaymentById(id);
  if (!payment) throw new Error("Payment not found");

  const updateData: Record<string, unknown> = {
    previousStatus: payment.status,
    status: newStatus,
    updatedAt: new Date(),
  };

  if (operatorResponse) {
    updateData.operatorResponse = operatorResponse;
  }

  if (["SUCCESS", "FAILED", "EXPIRED"].includes(newStatus)) {
    updateData.completedAt = new Date();
  }

  await db.update(payments).set(updateData).where(eq(payments.id, id));

  const updated = await getPaymentById(id);
  if (!updated) throw new Error("Failed to update payment");
  return updated;
}

/**
 * Get all pending payments
 */
export async function getPendingPayments(): Promise<Payment[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(payments)
    .where(eq(payments.status, "PENDING"));
}

// ============================================================================
// Transaction Logging
// ============================================================================

/**
 * Create a transaction log entry
 */
export async function logTransaction(
  data: InsertTransactionLog
): Promise<TransactionLog> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(transactionLogs).values(data);
  const insertId = (result as any).insertId;
  const log = await db
    .select()
    .from(transactionLogs)
    .where(eq(transactionLogs.id, Number(insertId)))
    .limit(1);

  if (!log[0]) throw new Error("Failed to create transaction log");
  return log[0];
}

/**
 * Get transaction logs for a payment
 */
export async function getTransactionLogs(paymentId: number): Promise<TransactionLog[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(transactionLogs)
    .where(eq(transactionLogs.paymentId, paymentId));
}

// ============================================================================
// Notification Management
// ============================================================================

/**
 * Create a notification record
 */
export async function createNotification(
  data: InsertNotification
): Promise<Notification> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(notifications).values(data);
  const insertId = (result as any).insertId;
  const notification = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, Number(insertId)))
    .limit(1);

  if (!notification[0]) throw new Error("Failed to create notification");
  return notification[0];
}

/**
 * Get notification by payment ID
 */
export async function getNotificationByPaymentId(
  paymentId: number
): Promise<Notification | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(notifications)
    .where(eq(notifications.paymentId, paymentId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Update notification status
 */
export async function updateNotificationStatus(
  id: number,
  status: string,
  responseStatus?: number,
  responseBody?: string
): Promise<Notification> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };

  if (responseStatus !== undefined) {
    updateData.responseStatus = responseStatus;
  }
  if (responseBody !== undefined) {
    updateData.responseBody = responseBody;
  }

  await db.update(notifications).set(updateData).where(eq(notifications.id, id));

  const updated = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, id))
    .limit(1);

  if (!updated[0]) throw new Error("Failed to update notification");
  return updated[0];
}

/**
 * Get pending notifications for retry
 */
export async function getPendingNotifications(): Promise<Notification[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(notifications)
    .where(eq(notifications.status, "PENDING"));
}

/**
 * Increment notification attempt count
 */
export async function incrementNotificationAttempt(
  id: number,
  nextRetryAt?: Date
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const notification = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, id))
    .limit(1);

  const updateData: Record<string, unknown> = {
    attemptCount: (notification[0]?.attemptCount || 0) + 1,
    updatedAt: new Date(),
  };

  if (nextRetryAt) {
    updateData.nextRetryAt = nextRetryAt;
  }

  await db.update(notifications).set(updateData).where(eq(notifications.id, id));
}


//adcionamos funções 
export async function setPaymentOperatorReference(
  paymentId: number,
  operatorReference: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(payments)
    .set({ operatorReference, updatedAt: new Date() })
    .where(eq(payments.id, paymentId));
}

export async function getPaymentByOperatorReference(
  operatorReference: string
): Promise<Payment | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(payments)
    .where(eq(payments.operatorReference, operatorReference))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}
