import { Pool } from "pg";

export async function initDatabaseSchema(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.warn("[Database] DATABASE_URL not configured, skipping schema init");
    return;
  }

  const pool = new Pool({
    connectionString,
  });

  try {
    console.log("[Database] Initializing PostgreSQL schema...");

    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('user', 'admin');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE payment_status AS ENUM (
          'CREATED',
          'PENDING',
          'SUCCESS',
          'FAILED',
          'EXPIRED',
          'COMPLETED'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE notification_status AS ENUM ('PENDING', 'SENT', 'FAILED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        "openId" VARCHAR(64) NOT NULL UNIQUE,
        "name" TEXT,
        "email" VARCHAR(320),
        "loginMethod" VARCHAR(64),
        "role" user_role NOT NULL DEFAULT 'user',
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "lastSignedIn" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        "transactionId" VARCHAR(64) NOT NULL UNIQUE,
        "operatorReference" VARCHAR(128),
        "externalSystemId" VARCHAR(128) NOT NULL,
        "amount" DECIMAL(12,2) NOT NULL,
        "currency" VARCHAR(3) NOT NULL DEFAULT 'MZN',
        "status" payment_status NOT NULL DEFAULT 'CREATED',
        "previousStatus" VARCHAR(32),
        "operatorResponse" JSONB,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "completedAt" TIMESTAMP,
        "expiresAt" TIMESTAMP,
        "ipAddress" VARCHAR(45),
        "userAgent" TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS transaction_logs (
        id SERIAL PRIMARY KEY,
        "paymentId" INTEGER NOT NULL,
        "eventType" VARCHAR(32) NOT NULL,
        "details" JSONB,
        "ipAddress" VARCHAR(45),
        "userAgent" TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        "paymentId" INTEGER NOT NULL,
        "externalSystemWebhook" VARCHAR(512) NOT NULL,
        "status" notification_status NOT NULL DEFAULT 'PENDING',
        "responseStatus" INTEGER,
        "responseBody" TEXT,
        "attemptCount" INTEGER NOT NULL DEFAULT 0,
        "nextRetryAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log("[Database] PostgreSQL schema initialized successfully");
  } catch (error) {
    console.error("[Database] Failed to initialize schema:", error);
    throw error;
  } finally {
    await pool.end();
  }
}
