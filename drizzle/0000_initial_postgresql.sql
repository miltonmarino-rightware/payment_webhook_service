CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."payment_intent_status" AS ENUM('requires_payment_method', 'requires_confirmation', 'processing', 'succeeded', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_method_type" AS ENUM('mpesa', 'emola', 'bank', 'card');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."provider_code" AS ENUM('paysuite', 'mpesa_direct', 'emola_direct', 'bank_direct');--> statement-breakpoint
CREATE TYPE "public"."provider_webhook_processing_status" AS ENUM('received', 'processed', 'ignored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"paymentId" integer NOT NULL,
	"externalSystemWebhook" varchar(512) NOT NULL,
	"status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"responseStatus" integer,
	"responseBody" text,
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"nextRetryAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"merchantId" varchar(128) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'MZN' NOT NULL,
	"status" "payment_intent_status" DEFAULT 'requires_payment_method' NOT NULL,
	"paymentMethod" "payment_method_type",
	"provider" "provider_code",
	"providerReference" varchar(128),
	"clientSecret" varchar(128) NOT NULL,
	"orderReference" varchar(128),
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"providerResponse" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp,
	CONSTRAINT "payment_intents_clientSecret_unique" UNIQUE("clientSecret")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"transactionId" varchar(64) NOT NULL,
	"operatorReference" varchar(128),
	"externalSystemId" varchar(128) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'MZN' NOT NULL,
	"status" "payment_status" DEFAULT 'CREATED' NOT NULL,
	"previousStatus" varchar(32),
	"operatorResponse" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	"expiresAt" timestamp,
	"ipAddress" varchar(45),
	"userAgent" text,
	CONSTRAINT "payments_transactionId_unique" UNIQUE("transactionId")
);
--> statement-breakpoint
CREATE TABLE "provider_webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" "provider_code" NOT NULL,
	"requestId" varchar(128) NOT NULL,
	"eventType" varchar(64) NOT NULL,
	"providerReference" varchar(128),
	"signature" varchar(256),
	"accountId" varchar(128),
	"payload" jsonb NOT NULL,
	"processingStatus" "provider_webhook_processing_status" DEFAULT 'received' NOT NULL,
	"errorMessage" text,
	"receivedAt" timestamp DEFAULT now() NOT NULL,
	"processedAt" timestamp,
	CONSTRAINT "provider_webhook_events_requestId_unique" UNIQUE("requestId")
);
--> statement-breakpoint
CREATE TABLE "transaction_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"paymentId" integer NOT NULL,
	"eventType" varchar(32) NOT NULL,
	"details" jsonb,
	"ipAddress" varchar(45),
	"userAgent" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
