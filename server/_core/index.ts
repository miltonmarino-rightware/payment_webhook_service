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

  // Enable CORS for all routes - reflect the request origin to support credentials
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

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  /**
   * IMPORTANT:
   * Parse JSON FIRST and keep rawBody for signature verification (Stripe needs exact raw bytes).
   * This must run BEFORE any signature middleware.
   */
  app.use(
    express.json({
      limit: "50mb",
      verify: (req: any, _res, buf) => {
        req.rawBody = buf; // Buffer exato do body
      },
    })
  );
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Signature audit logger (shared)
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

  /**
   * Apply mPesa signature middleware for ALL routes EXCEPT Stripe webhooks.
   * This prevents Stripe webhooks from being blocked/modified by mPesa security layer.
   */
  const mpesaMw = mpesaSignatureMiddleware(defaultMpesaSignatureConfig, signatureAuditLogger);
  app.use((req, res, next) => {
    // Não aplicar mPesa middleware no Stripe webhook
    if (req.originalUrl.startsWith("/webhooks/stripe")) return next();
    return mpesaMw(req, res, next);
  });

  // Apply global correlation ID middleware
  app.use(correlationIdMiddleware);

  // Initialize compliance services
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

  // Register compliance pipeline middleware
  registerCompliancePipelineMiddleware(app, auditTrailService, complianceModeService);

  registerOAuthRoutes(app);

  // Register webhook routes (mPesa signature verification applied above, Stripe excluded above)
  app.use("/webhooks", webhookRoutes);

  // Register payment routes (no signature verification needed - internal only)
  app.use("/payments", paymentsRoutes);

  // Register Stripe routes (multi-operator support)
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

  // Start notification processor
  startNotificationProcessor(60000); // Check every 60 seconds
}

startServer().catch(console.error);
