CREATE TYPE "public"."merchant_status" AS ENUM('active', 'suspended', 'revoked');
--> statement-breakpoint
CREATE TABLE "merchants" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "name" varchar(160) NOT NULL,
  "status" "merchant_status" DEFAULT 'active' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_api_keys" (
  "id" serial PRIMARY KEY NOT NULL,
  "merchantId" varchar(128) NOT NULL,
  "keyPrefix" varchar(32) NOT NULL,
  "keyHash" varchar(64) NOT NULL,
  "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "environment" varchar(16) DEFAULT 'test' NOT NULL,
  "lastUsedAt" timestamp,
  "expiresAt" timestamp,
  "revokedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "merchant_api_keys_keyPrefix_unique" UNIQUE("keyPrefix"),
  CONSTRAINT "merchant_api_keys_keyHash_unique" UNIQUE("keyHash")
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
  "id" serial PRIMARY KEY NOT NULL,
  "merchantId" varchar(128) NOT NULL,
  "operation" varchar(64) NOT NULL,
  "idempotencyKey" varchar(128) NOT NULL,
  "requestHash" varchar(64) NOT NULL,
  "responseStatus" integer,
  "responseBody" jsonb,
  "resourceId" varchar(128),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "expiresAt" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_api_keys" ADD CONSTRAINT "merchant_api_keys_merchantId_merchants_id_fk" FOREIGN KEY ("merchantId") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_merchantId_merchants_id_fk" FOREIGN KEY ("merchantId") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_merchant_operation_key_unique" ON "idempotency_records" USING btree ("merchantId", "operation", "idempotencyKey");
