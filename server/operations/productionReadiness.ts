import type { Express } from "express";
import { and, eq, lt, sql } from "drizzle-orm";
import { idempotencyRecords, outboundWebhookEvents } from "../../drizzle/schema";
import { getDb } from "../db";

export type ReadinessCheck = {
  ok: boolean;
  database: "up" | "down";
  redis: "up" | "down";
  timestamp: string;
};

export type ReadinessRedisClient = {
  isReady: boolean;
  ping(): Promise<string>;
};

export function isInternalRequestAuthorized(provided: string | undefined, expected: string | undefined): boolean {
  return Boolean(expected && provided && provided.length === expected.length && provided === expected);
}

export async function checkReadiness(redis: ReadinessRedisClient): Promise<ReadinessCheck> {
  let database: ReadinessCheck["database"] = "down";
  let redisStatus: ReadinessCheck["redis"] = "down";

  try {
    const db = await getDb();
    if (db) {
      await db.execute(sql`SELECT 1`);
      database = "up";
    }
  } catch {
    database = "down";
  }

  try {
    if (redis.isReady && (await redis.ping()) === "PONG") redisStatus = "up";
  } catch {
    redisStatus = "down";
  }

  return {
    ok: database === "up" && redisStatus === "up",
    database,
    redis: redisStatus,
    timestamp: new Date().toISOString(),
  };
}

export async function recoverStuckOutboundWebhooks(staleAfterMs = 5 * 60_000): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const staleBefore = new Date(Date.now() - staleAfterMs);
  const recovered = await db
    .update(outboundWebhookEvents)
    .set({
      status: "retrying",
      nextAttemptAt: new Date(),
      lastError: "recovered_stuck_delivery",
      updatedAt: new Date(),
    })
    .where(and(eq(outboundWebhookEvents.status, "delivering"), lt(outboundWebhookEvents.updatedAt, staleBefore)))
    .returning({ id: outboundWebhookEvents.id });
  return recovered.length;
}

export async function runRetentionMaintenance(now = new Date()): Promise<{ idempotencyDeleted: number; webhooksDeleted: number }> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");

  const expiredIdempotency = await db
    .delete(idempotencyRecords)
    .where(lt(idempotencyRecords.expiresAt, now))
    .returning({ id: idempotencyRecords.id });

  const retentionDays = Math.max(30, Number(process.env.OUTBOUND_WEBHOOK_RETENTION_DAYS ?? 180));
  const deliveredBefore = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const oldDelivered = await db
    .delete(outboundWebhookEvents)
    .where(and(eq(outboundWebhookEvents.status, "delivered"), lt(outboundWebhookEvents.deliveredAt, deliveredBefore)))
    .returning({ id: outboundWebhookEvents.id });

  return { idempotencyDeleted: expiredIdempotency.length, webhooksDeleted: oldDelivered.length };
}

export async function collectOperationalMetrics(): Promise<Record<string, number>> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
      COUNT(*) FILTER (WHERE status = 'retrying')::int AS retrying,
      COUNT(*) FILTER (WHERE status = 'delivering')::int AS delivering,
      COUNT(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter,
      COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered
    FROM outbound_webhook_events
  `);
  const row = (result.rows?.[0] ?? {}) as Record<string, unknown>;
  return {
    outboundWebhookQueued: Number(row.queued ?? 0),
    outboundWebhookRetrying: Number(row.retrying ?? 0),
    outboundWebhookDelivering: Number(row.delivering ?? 0),
    outboundWebhookDeadLetter: Number(row.dead_letter ?? 0),
    outboundWebhookDelivered: Number(row.delivered ?? 0),
  };
}

export function registerProductionReadinessRoutes(app: Express, redis: ReadinessRedisClient): void {
  app.get("/api/health/live", (_req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

  app.get("/api/health/ready", async (_req, res) => {
    const readiness = await checkReadiness(redis);
    res.status(readiness.ok ? 200 : 503).json(readiness);
  });

  app.get("/internal/metrics", async (req, res) => {
    const token = req.header("x-internal-operations-token");
    if (!isInternalRequestAuthorized(token, process.env.INTERNAL_OPERATIONS_TOKEN)) {
      res.status(401).json({ error: "internal_authentication_required" });
      return;
    }
    try {
      res.json({ ...(await collectOperationalMetrics()), timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ error: "metrics_unavailable" });
    }
  });
}

export function startOperationalMaintenance(intervalMs = 60_000): ReturnType<typeof setInterval> {
  const run = async () => {
    try {
      const recovered = await recoverStuckOutboundWebhooks();
      if (recovered > 0) console.warn(`[Operations] Recovered ${recovered} stuck outbound webhook(s)`);
      const metrics = await collectOperationalMetrics();
      if (metrics.outboundWebhookDeadLetter > 0) {
        console.error(`[Operations] ALERT: ${metrics.outboundWebhookDeadLetter} outbound webhook(s) in dead-letter`);
      }
    } catch (error) {
      console.error("[Operations] Maintenance cycle failed:", error);
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
