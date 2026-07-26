import "dotenv/config";
import { eq } from "drizzle-orm";
import { merchantWebhookEndpoints } from "../drizzle/schema";
import { getDb } from "../server/db";
import { encryptJson } from "../server/security/dataEncryption";

async function main() {
  const merchantId = "merchant_the_board";
  const url = "http://127.0.0.1:8081/api/payments/webhook";
  const secret = process.env.THE_BOARD_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error("THE_BOARD_WEBHOOK_SECRET não encontrada no .env");
  }

  const db = await getDb();
  if (!db) {
    throw new Error("database_unavailable");
  }

  const encryptedSecret = encryptJson(
    secret,
    `merchant-webhook:${merchantId}`
  );

  const existing = await db
    .select({ id: merchantWebhookEndpoints.id })
    .from(merchantWebhookEndpoints)
    .where(eq(merchantWebhookEndpoints.merchantId, merchantId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(merchantWebhookEndpoints)
      .set({
        url,
        secret: encryptedSecret,
        enabled: 1,
        updatedAt: new Date(),
      })
      .where(eq(merchantWebhookEndpoints.merchantId, merchantId));
  } else {
    await db.insert(merchantWebhookEndpoints).values({
      merchantId,
      url,
      secret: encryptedSecret,
      enabled: 1,
    });
  }

  console.log("Webhook do THE BOARD configurado com segredo cifrado.");
  console.log(`Endpoint: ${url}`);
}

main().catch((error) => {
  console.error(
    "Falha ao configurar webhook do THE BOARD:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
