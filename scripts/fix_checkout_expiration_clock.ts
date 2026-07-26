import fs from "node:fs";
import path from "node:path";

const target = path.resolve(
  process.cwd(),
  "server/gateway/payment-sessions/paymentSession.service.ts"
);

const source = fs.readFileSync(target, "utf8");

const importOld = 'import { and, eq } from "drizzle-orm";';
const importNew = 'import { and, eq, sql } from "drizzle-orm";';

const blockOld = `  if (rows[0].status === "active" && rows[0].expiresAt.getTime() <= Date.now()) {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(paymentSessions)
        .set({ status: "expired", updatedAt: now })
        .where(eq(paymentSessions.id, id));
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
  }`;

const blockNew = `  if (rows[0].status === "active") {
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
  }`;

let updated = source;

if (updated.includes(importOld)) {
  updated = updated.replace(importOld, importNew);
} else if (!updated.includes(importNew)) {
  throw new Error("Import esperado do drizzle-orm não encontrado.");
}

if (updated.includes(blockOld)) {
  updated = updated.replace(blockOld, blockNew);
} else if (updated.includes('sql`${paymentSessions.expiresAt} <= NOW()`')) {
  console.log("A correção do relógio de expiração já está aplicada.");
  process.exit(0);
} else {
  throw new Error("Bloco antigo de expiração não encontrado; nenhum ficheiro foi alterado.");
}

fs.writeFileSync(target, updated, "utf8");
console.log("Expiração corrigida para usar o relógio do PostgreSQL.");
