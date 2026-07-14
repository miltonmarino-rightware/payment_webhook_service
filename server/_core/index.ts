import { initDatabaseSchema } from "./initDatabase";
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import webhookRoutes from "../webhooks";
import paymentsRoutes from "../payments";
import paymentIntentRoutes from "../gateway/payment-intents/paymentIntent.routes";
import paysuiteWebhookRoutes from "../gateway/webhooks/paysuiteWebhook.routes";
import { createStripeRouter } from "../routes/stripe.routes";
import { startNotificationProcessor } from "../notifications";
import {
  mpesaSignatureMiddleware,
  defaultMpesaSignatureConfig,
  createSignatureAuditLogger,
} from "../security/mpesaSignature.middleware";
import * as db from "../db";
import { correlationIdMiddleware } from "../compliance/correlationId.middleware";
import { AuditTrailService } from "../compliance/auditTrail.service";
import { ComplianceModeService } from "../compliance/complianceMode.service";
import { registerCompliancePipelineMiddleware } from "../compliance/compliancePipeline.middleware";
import { createClient } from "redis";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  await initDatabaseSchema();

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );
    res.header("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(
    express.json({
      limit: "50mb",
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  const signatureAuditLogger = createSignatureAuditLogger(
    async (event: string, details: Record<string, unknown>) => {
      try {
        await db.logTransaction({
          paymentId: 0,
          eventType: event,
          details,
          ipAddress: (details.ipAddress as string) || "unknown",
          userAgent: "webhook-security",
        });
      } catch (error) {
        console.error(`[SECURITY] Failed to log ${event}:`, error);
      }
    }
  );

  const mpesaMw = mpesaSignatureMiddleware(defaultMpesaSignatureConfig, signatureAuditLogger);
  app.use((req, res, next) => {
    const excludedFromMpesaSignature =
      req.originalUrl.startsWith("/webhooks/stripe") ||
      req.originalUrl.startsWith("/webhooks/paysuite") ||
      req.originalUrl.startsWith("/v1/");

    if (excludedFromMpesaSignature) return next();
    return mpesaMw(req, res, next);
  });

  app.use(correlationIdMiddleware);

  const redis = createClient({
    url: process.env.REDIS_URL,
  });

  redis.on("error", (err) => {
    console.error("Redis error:", err);
  });

  await redis.connect();

  const auditTrailService = new AuditTrailService(redis);
  const complianceModeService = new ComplianceModeService(
    auditTrailService,
    process.env.COMPLIANCE_MODE === "true"
  );

  registerCompliancePipelineMiddleware(app, auditTrailService, complianceModeService);

  registerOAuthRoutes(app);
  app.use("/webhooks", webhookRoutes);
  app.use("/webhooks", paysuiteWebhookRoutes);
  app.use("/payments", paymentsRoutes);
  app.use("/v1", paymentIntentRoutes);

  const stripeRouter = createStripeRouter();
  app.use("/", stripeRouter);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  const preferredPort = parseInt(process.env.PORT || "3000", 10);
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });

  startNotificationProcessor(60000);
}

startServer().catch(console.error);
