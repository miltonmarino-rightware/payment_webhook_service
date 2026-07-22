import "dotenv/config";
import { eq } from "drizzle-orm";
import { merchantApiKeys } from "../drizzle/schema";
import { getDb } from "../server/db";

async function main() {
  const prefix = process.env.MERCHANT_KEY_PREFIX_TO_REVOKE?.trim();
  if (!prefix) throw new Error("MERCHANT_KEY_PREFIX_TO_REVOKE_required");

  const db = await getDb();
  if (!db) throw new Error("database_unavailable");

  const result = await db
    .update(merchantApiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(merchantApiKeys.keyPrefix, prefix))
    .returning({ id: merchantApiKeys.id, merchantId: merchantApiKeys.merchantId });

  if (!result[0]) throw new Error("merchant_api_key_not_found");
  console.log(`Revoked API key prefix ${prefix} for merchant ${result[0].merchantId}.`);
}

main().catch((error) => {
  console.error("Failed to revoke merchant API key:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
