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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_payment_intent_outbound_webhook() RETURNS trigger AS $$
DECLARE
  outbound_type text;
  generated_event_id text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  outbound_type := CASE NEW.status
    WHEN 'processing' THEN 'payment_intent.processing'
    WHEN 'succeeded' THEN 'payment_intent.succeeded'
    WHEN 'failed' THEN 'payment_intent.failed'
    WHEN 'cancelled' THEN 'payment_intent.cancelled'
    WHEN 'expired' THEN 'payment_intent.expired'
    ELSE NULL
  END;

  IF outbound_type IS NULL THEN
    RETURN NEW;
  END IF;

  generated_event_id := 'evt_' || md5(random()::text || clock_timestamp()::text || NEW.id || NEW.status::text);

  INSERT INTO outbound_webhook_events (
    "eventId", "merchantId", "paymentIntentId", "eventType", payload
  ) VALUES (
    generated_event_id,
    NEW."merchantId",
    NEW.id,
    outbound_type,
    jsonb_build_object(
      'id', generated_event_id,
      'type', outbound_type,
      'createdAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'data', jsonb_build_object(
        'paymentIntent', jsonb_strip_nulls(jsonb_build_object(
          'id', NEW.id,
          'merchantId', NEW."merchantId",
          'amount', NEW.amount::numeric,
          'currency', NEW.currency,
          'status', NEW.status,
          'orderReference', NEW."orderReference",
          'providerReference', NEW."providerReference"
        ))
      )
    )
  ) ON CONFLICT ("merchantId", "paymentIntentId", "eventType") DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_intent_outbound_webhook_trigger
AFTER UPDATE OF status ON payment_intents
FOR EACH ROW EXECUTE FUNCTION enqueue_payment_intent_outbound_webhook();