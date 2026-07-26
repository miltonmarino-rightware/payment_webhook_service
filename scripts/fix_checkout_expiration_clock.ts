import fs from "node:fs";
import path from "node:path";

const target = path.resolve(
  process.cwd(),
  "server/gateway/payment-sessions/paymentSession.service.ts"
);

const source = fs.readFileSync(target, "utf8");
const importOld = 'import { and, eq } from "drizzle-orm";';
const importNew = 'import { and, eq, sql } from "drizzle-orm";';

const replacement = `  if (rows[0].status === "active") {
    const expired = await db
      .select({ id: paymentSessions.id })
      .from(paymentSessions)
      .where(
        and(
          eq(paymentSessions.id, id),
          eq(paymentSessions.status, "active"),
          sql\`\${paymentSessions.expiresAt} <= NOW()\`
        )
      )
      .limit(1);

    if (expired[0]) {
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(paymentSessions)
          .set({ status: "expired", updatedAt: now })
          .where(and(eq(paymentSessions.id, id), eq(paymentSessions.status, "active")));
        await tx
          .update(paymentIntents)
          .set({ status: "expired", expiredAt: now, updatedAt: now })
          .where(
            and(
              eq(paymentIntents.id, rows[0].paymentIntentId),
              eq(paymentIntents.status, "requires_payment_method")
            )
          );
      });
      rows[0].status = "expired";
    }
  }
`;

let updated = source;

if (updated.includes(importOld)) {
  updated = updated.replace(importOld, importNew);
} else if (!updated.includes(importNew)) {
  throw new Error("Import esperado do drizzle-orm não encontrado.");
}

if (updated.includes('sql`${paymentSessions.expiresAt} <= NOW()`')) {
  console.log("A correção do relógio de expiração já está aplicada.");
  process.exit(0);
}

const startMarker = '  if (rows[0].status === "active" && rows[0].expiresAt.getTime() <= Date.now()) {';
const endMarker = '  return toDomain(rows[0]);';
const start = updated.indexOf(startMarker);
const end = updated.indexOf(endMarker, start === -1 ? 0 : start);

if (start === -1 || end === -1 || end <= start) {
  throw new Error("Bloco antigo de expiração não encontrado; nenhum ficheiro foi alterado.");
}

updated = updated.slice(0, start) + replacement + updated.slice(end);
fs.writeFileSync(target, updated, "utf8");
console.log("Expiração corrigida para usar o relógio do PostgreSQL.");
