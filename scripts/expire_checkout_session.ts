import "dotenv/config";
import pg from "pg";

async function main(): Promise<void> {
  const sessionId = process.argv[2]?.trim();

  if (!sessionId || !/^ps_[a-zA-Z0-9]+$/.test(sessionId)) {
    throw new Error(
      "Uso: pnpm exec tsx scripts/expire_checkout_session.ts <sessionId>"
    );
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não encontrada no ambiente.");
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();
    const result = await client.query(
      `UPDATE payment_sessions
         SET "expiresAt" = NOW() - INTERVAL '5 minutes',
             "updatedAt" = NOW()
       WHERE id = $1
       RETURNING id, "expiresAt"`,
      [sessionId]
    );

    if (result.rowCount !== 1) {
      throw new Error("Sessão não encontrada; nenhum registo foi alterado.");
    }

    console.log(`Sessão expirada em sandbox: ${result.rows[0].id}`);
    console.log(`expiresAt: ${new Date(result.rows[0].expiresAt).toISOString()}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Erro desconhecido";
  console.error(`Falha ao expirar sessão: ${message}`);
  process.exitCode = 1;
});
