ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "branding" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "checkoutConfig" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "allowedRedirectOrigins" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "payment_sessions" ADD COLUMN IF NOT EXISTS "items" jsonb;
UPDATE "payment_sessions"
SET "items" = jsonb_build_array("product")
WHERE "items" IS NULL AND "product" IS NOT NULL;
ALTER TABLE "payment_sessions" ALTER COLUMN "items" SET NOT NULL;
ALTER TABLE "payment_sessions" DROP COLUMN IF EXISTS "product";
