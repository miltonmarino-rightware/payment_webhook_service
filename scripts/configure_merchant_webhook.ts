import "dotenv/config";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { merchantWebhookEndpoints, merchants } from "../drizzle/schema";
import { getDb } from "../server/db";
import { encryptJson } from "../server/security/dataEncryption";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
}

async function main() {
  const merchantId = required("MERCHANT_WEBHOOK_MERCHANT_ID");
  const url = required("MERCHANT_WEBHOOK_URL");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("merchant_webhook_https_required");
  }

  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const merchant = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  if (!merchant[0]) throw new Error("merchant_not_found");

  const secret = crypto.randomBytes(32).toString("base64url");
  const encryptedSecret = encryptJson(secret, `merchant-webhook:${merchantId}`);
  const existing = await db.select({ id: merchantWebhookEndpoints.id }).from(merchantWebhookEndpoints).where(eq(merchantWebhookEndpoints.merchantId, merchantId)).limit(1);

  if (existing[0]) {
    await db.update(merchantWebhookEndpoints).set({ url, secret: encryptedSecret, enabled: 1, updatedAt: new Date() }).where(eq(merchantWebhookEndpoints.id, existing[0].id));
  } else {
    await db.insert(merchantWebhookEndpoints).values({ merchantId, url, secret: encryptedSecret, enabled: 1 });
  }

  console.log("Merchant webhook configured. Store the signing secret securely; it will not be shown again.");
  console.log(`Merchant ID: ${merchantId}`);
  console.log(`Webhook URL: ${url}`);
  console.log(`Webhook Secret: ${secret}`);
}

main().catch((error) => {
  console.error("Failed to configure merchant webhook:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
