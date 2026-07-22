import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { idempotencyRecords, merchantApiKeys, merchants } from "../../../drizzle/schema";
import { getDb } from "../../db";

export type MerchantScope = "payment_intents:read" | "payment_intents:write" | "payment_intents:confirm";
export type MerchantContext = { merchantId: string; keyId: number; scopes: string[]; environment: string };
export type MerchantRequest = Request & { merchant?: MerchantContext };

export function hashApiKey(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashRequestBody(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

export function extractApiKey(req: Request): string | null {
  const direct = req.get("x-api-key");
  if (direct) return direct.trim();
  const authorization = req.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
}

export function apiKeyPrefix(apiKey: string): string {
  const parts = apiKey.split("_");
  if (parts.length < 4) throw new Error("invalid_api_key");
  return parts.slice(0, 3).join("_");
}

export function requireMerchantScope(scope: MerchantScope) {
  return async (req: MerchantRequest, res: Response, next: NextFunction) => {
    try {
      const apiKey = extractApiKey(req);
      if (!apiKey) return res.status(401).json({ error: "api_key_required" });
      const prefix = apiKeyPrefix(apiKey);
      const db = await getDb();
      if (!db) return res.status(503).json({ error: "service_unavailable" });
      const rows = await db
        .select({ key: merchantApiKeys, merchant: merchants })
        .from(merchantApiKeys)
        .innerJoin(merchants, eq(merchantApiKeys.merchantId, merchants.id))
        .where(and(eq(merchantApiKeys.keyPrefix, prefix), eq(merchants.status, "active")))
        .limit(1);
      const row = rows[0];
      if (!row || row.key.revokedAt || (row.key.expiresAt && row.key.expiresAt <= new Date())) {
        return res.status(401).json({ error: "invalid_api_key" });
      }
      const actual = Buffer.from(hashApiKey(apiKey), "hex");
      const expected = Buffer.from(row.key.keyHash, "hex");
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
        return res.status(401).json({ error: "invalid_api_key" });
      }
      if (!row.key.scopes.includes(scope)) return res.status(403).json({ error: "insufficient_scope" });
      req.merchant = { merchantId: row.merchant.id, keyId: row.key.id, scopes: row.key.scopes, environment: row.key.environment };
      await db.update(merchantApiKeys).set({ lastUsedAt: new Date() }).where(eq(merchantApiKeys.id, row.key.id));
      return next();
    } catch {
      return res.status(401).json({ error: "invalid_api_key" });
    }
  };
}

export async function enforceRateLimit(req: MerchantRequest, res: Response, next: NextFunction) {
  const redis = req.app.locals.redis;
  if (!redis || !req.merchant) return res.status(503).json({ error: "rate_limit_unavailable" });
  const windowSeconds = Number(process.env.MERCHANT_RATE_LIMIT_WINDOW_SECONDS ?? 60);
  const maxRequests = Number(process.env.MERCHANT_RATE_LIMIT_MAX_REQUESTS ?? 120);
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `gateway:ratelimit:${req.merchant.merchantId}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds + 1);
  res.setHeader("X-RateLimit-Limit", String(maxRequests));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, maxRequests - count)));
  if (count > maxRequests) return res.status(429).json({ error: "rate_limit_exceeded" });
  return next();
}

export async function findIdempotencyRecord(merchantId: string, operation: string, key: string, requestHash: string) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const rows = await db.select().from(idempotencyRecords).where(and(eq(idempotencyRecords.merchantId, merchantId), eq(idempotencyRecords.operation, operation), eq(idempotencyRecords.idempotencyKey, key))).limit(1);
  const record = rows[0];
  if (!record) return null;
  if (record.requestHash !== requestHash) throw new Error("idempotency_key_reused_with_different_payload");
  return record;
}

export async function storeIdempotencyRecord(input: { merchantId: string; operation: string; key: string; requestHash: string; responseStatus: number; responseBody: unknown; resourceId?: string }) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  await db.insert(idempotencyRecords).values({ merchantId: input.merchantId, operation: input.operation, idempotencyKey: input.key, requestHash: input.requestHash, responseStatus: input.responseStatus, responseBody: input.responseBody, resourceId: input.resourceId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }).onConflictDoNothing();
}
