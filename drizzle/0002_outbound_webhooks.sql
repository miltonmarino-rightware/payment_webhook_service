CREATE TYPE "public"."outbound_webhook_status" AS ENUM('queued', 'delivering', 'retrying', 'delivered', 'dead_letter');
--> statement-breakpoint
CREATE TABLE "merchant_webhook_endpoints" (
  "id" serial PRIMARY KEY NOT NULL,
  "merchantId" varchar(128) NOT NULL,
  "url" varchar(1024) NOT NULL,
  "secret" jsonb NOT NULL,
  "enabled" integer DEFAULT 1 NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_webhook_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "eventId" varchar(128) NOT NULL,
  "merchantId" varchar(128) NOT NULL,
  "paymentIntentId" varchar(64) NOT NULL,
  "eventType" varchar(64) NOT NULL,
  "payload" jsonb NOT NULL,
  "status" "outbound_webhook_status" DEFAULT 'queued' NOT NULL,
  "attemptCount" integer DEFAULT 0 NOT NULL,
  "maxAttempts" integer DEFAULT 8 NOT NULL,
  "nextAttemptAt" timestamp DEFAULT now() NOT NULL,
  "lastResponseStatus" integer,
  "lastResponseBody" text,
  "lastError" text,
  "deliveredAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "outbound_webhook_events_eventId_unique" UNIQUE("eventId")
);
--> statement-breakpoint
ALTER TABLE "merchant_webhook_endpoints" ADD CONSTRAINT "merchant_webhook_endpoints_merchantId_merchants_id_fk" FOREIGN KEY ("merchantId") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "outbound_webhook_events" ADD CONSTRAINT "outbound_webhook_events_merchantId_merchants_id_fk" FOREIGN KEY ("merchantId") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_webhook_endpoints_merchant_unique" ON "merchant_webhook_endpoints" USING btree ("merchantId");
--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_webhook_event_transition_unique" ON "outbound_webhook_events" USING btree ("merchantId","paymentIntentId","eventType");