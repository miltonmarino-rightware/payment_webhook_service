DO $$ BEGIN
  CREATE TYPE "payment_session_status" AS ENUM ('active', 'completed', 'cancelled', 'expired');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "paidAt" timestamp;
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "failedAt" timestamp;
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "cancelledAt" timestamp;
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "expiredAt" timestamp;

CREATE TABLE IF NOT EXISTS "payment_sessions" (
  "id" varchar(80) PRIMARY KEY NOT NULL,
  "paymentIntentId" varchar(64) NOT NULL UNIQUE,
  "merchantId" varchar(128) NOT NULL,
  "reference" varchar(128) NOT NULL,
  "status" "payment_session_status" DEFAULT 'active' NOT NULL,
  "product" jsonb NOT NULL,
  "customer" jsonb NOT NULL,
  "returnUrl" varchar(1024) NOT NULL,
  "cancelUrl" varchar(1024) NOT NULL,
  "locale" varchar(16) DEFAULT 'pt-MZ' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "completedAt" timestamp,
  "cancelledAt" timestamp,
  CONSTRAINT "payment_sessions_paymentIntentId_payment_intents_id_fk" FOREIGN KEY ("paymentIntentId") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "payment_sessions_merchantId_merchants_id_fk" FOREIGN KEY ("merchantId") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_sessions_merchant_reference_unique" ON "payment_sessions" USING btree ("merchantId", "reference");
