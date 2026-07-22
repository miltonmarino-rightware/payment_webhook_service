import "dotenv/config";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { merchantApiKeys, merchants } from "../drizzle/schema";
import { getDb } from "../server/db";
import { hashApiKey } from "../server/gateway/security/merchantSecurity";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
}

async function main() {
  const merchantId = required("MERCHANT_BOOTSTRAP_ID");
  const merchantName = process.env.MERCHANT_BOOTSTRAP_NAME?.trim() || merchantId;
  const environment = process.env.MERCHANT_BOOTSTRAP_ENVIRONMENT?.trim() || "test";
  const scopes = [
    "payment_intents:read",
    "payment_intents:write",
    "payment_intents:confirm",
  ];

  const db = await getDb();
  if (!db) throw new Error("database_unavailable");

  const existingMerchant = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (!existingMerchant[0]) {
    await db.insert(merchants).values({ id: merchantId, name: merchantName });
  }

  const prefix = `gw_${environment}_${crypto.randomBytes(4).toString("hex")}`;
  const secret = crypto.randomBytes(32).toString("base64url");
  const apiKey = `${prefix}_${secret}`;

  await db.insert(merchantApiKeys).values({
    merchantId,
    keyPrefix: prefix,
    keyHash: hashApiKey(apiKey),
    scopes,
    environment,
  });

  console.log("Merchant API key created. Store it securely; it will not be shown again.");
  console.log(`Merchant ID: ${merchantId}`);
  console.log(`Environment: ${environment}`);
  console.log(`API Key: ${apiKey}`);
}

main().catch((error) => {
  console.error("Failed to create merchant API key:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
