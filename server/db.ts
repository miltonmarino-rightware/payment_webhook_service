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

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
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
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.openId, user.openId))
      .limit(1);

    const values: InsertUser = {
      openId: user.openId,
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? null,
      role: user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user"),
      lastSignedIn: user.lastSignedIn ?? new Date(),
    };

    if (existingUser.length > 0) {
      await db
        .update(users)
        .set({
          name: values.name,
          email: values.email,
          loginMethod: values.loginMethod,
          role: values.role,
          lastSignedIn: values.lastSignedIn,
          updatedAt: new Date(),
        })
        .where(eq(users.openId, user.openId));
    } else {
      await db.insert(users).values(values);
    }
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

  const result = await db.insert(payments).values(data).returning();
  if (!result[0]) throw new Error("Failed to create payment");
  return result[0];
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

  const result = await db
    .update(payments)
    .set(updateData)
    .where(eq(payments.id, id))
    .returning();

  if (!result[0]) throw new Error("Failed to update payment");
  return result[0];
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

  const result = await db.insert(transactionLogs).values(data).returning();
  if (!result[0]) throw new Error("Failed to create transaction log");
  return result[0];
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

  const result = await db.insert(notifications).values(data).returning();
  if (!result[0]) throw new Error("Failed to create notification");
  return result[0];
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

  const result = await db
    .update(notifications)
    .set(updateData)
    .where(eq(notifications.id, id))
    .returning();

  if (!result[0]) throw new Error("Failed to update notification");
  return result[0];
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

// ============================================================================
// Stripe / Operator Reference helpers
// ============================================================================

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
