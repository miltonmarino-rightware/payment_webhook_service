import "dotenv/config";
import pg from "pg";

const sessionId = process.argv[2]?.trim();

if (!sessionId || !/^ps_[a-zA-Z0-9]+$/.test(sessionId)) {
  console.error("Uso: pnpm exec tsx scripts/expire_checkout_session.ts <sessionId>");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não encontrada no ambiente.");
  process.exit(1);
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
    console.error("Sessão não encontrada; nenhum registo foi alterado.");
    process.exitCode = 1;
  } else {
    console.log(`Sessão expirada em sandbox: ${result.rows[0].id}`);
    console.log(`expiresAt: ${new Date(result.rows[0].expiresAt).toISOString()}`);
  }
} finally {
  await client.end();
}
