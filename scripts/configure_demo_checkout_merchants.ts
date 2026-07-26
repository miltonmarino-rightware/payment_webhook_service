import "dotenv/config";
import { eq } from "drizzle-orm";
import { merchants } from "../drizzle/schema";
import { getDb } from "../server/db";

type MerchantCheckoutConfig = {
  id: string;
  branding: {
    displayName: string;
    primaryColor: string;
    theme: "light" | "dark";
  };
  checkoutConfig: {
    allowedPaymentMethods: Array<"mpesa" | "emola">;
    defaultExpiresInSeconds: number;
  };
  allowedRedirectOrigins: string[];
};

const configurations: MerchantCheckoutConfig[] = [
  {
    id: "merchant_the_board",
    branding: {
      displayName: "THE BOARD",
      primaryColor: "#C9A227",
      theme: "dark",
    },
    checkoutConfig: {
      allowedPaymentMethods: ["mpesa", "emola"],
      defaultExpiresInSeconds: 1800,
    },
    allowedRedirectOrigins: [
      "http://localhost:8081",
      "http://127.0.0.1:8081",
    ],
  },
  {
    id: "merchant_demo_store",
    branding: {
      displayName: "Demo Store",
      primaryColor: "#2563EB",
      theme: "light",
    },
    checkoutConfig: {
      allowedPaymentMethods: ["mpesa"],
      defaultExpiresInSeconds: 1800,
    },
    allowedRedirectOrigins: [
      "http://localhost:8082",
      "http://127.0.0.1:8082",
    ],
  },
];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");

  for (const configuration of configurations) {
    const updated = await db
      .update(merchants)
      .set({
        branding: configuration.branding,
        checkoutConfig: configuration.checkoutConfig,
        allowedRedirectOrigins: configuration.allowedRedirectOrigins,
        updatedAt: new Date(),
      })
      .where(eq(merchants.id, configuration.id))
      .returning({ id: merchants.id, name: merchants.name });

    if (!updated[0]) {
      throw new Error(`merchant_not_found:${configuration.id}`);
    }

    console.log(
      `${updated[0].id}: checkout configurado para ${configuration.branding.displayName}`
    );
  }

  console.log("Configuração multi-merchant aplicada com sucesso.");
}

main().catch((error) => {
  console.error(
    "Falha ao configurar merchants:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
