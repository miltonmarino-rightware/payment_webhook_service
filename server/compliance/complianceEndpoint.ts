/**
 * Internal Compliance Audit Status Endpoint
 * 
 * Protected endpoint for internal monitoring and compliance reporting.
 * Requires internal API key authentication.
 * 
 * Endpoint: GET /internal/audit/status
 * 
 * Returns comprehensive compliance metrics including:
 * - Audit trail integrity status
 * - Total events logged
 * - Last event hash (for verification)
 * - Compliance mode status
 * - Security breach detection status
 * - Webhook lock status
 */

import { Request, Response } from "express";
import { AuditTrailService } from "./auditTrail.service";
import { ComplianceModeService } from "./complianceMode.service";
import { getCorrelationId } from "./correlationId.middleware";

/**
 * Middleware to verify internal API key
 * Protects sensitive compliance endpoints
 */
export function verifyInternalApiKey(req: Request, res: Response, next: Function) {
  const apiKey = req.headers["x-internal-api-key"] as string;
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    console.warn("[ComplianceEndpoint] INTERNAL_API_KEY not configured");
    return res.status(500).json({
      error: "Internal API key not configured",
      correlationId: getCorrelationId(req),
    });
  }

  if (!apiKey || apiKey !== expectedKey) {
    console.warn("[ComplianceEndpoint] Invalid or missing API key from", req.ip);
    return res.status(401).json({
      error: "Unauthorized - Invalid API key",
      correlationId: getCorrelationId(req),
    });
  }

  next();
}

/**
 * GET /internal/audit/status
 * Returns comprehensive compliance and audit status
 */
export async function getAuditStatus(
  auditTrailService: AuditTrailService,
  complianceModeService: ComplianceModeService
) {
  return async (req: Request, res: Response) => {
    try {
      const correlationId = getCorrelationId(req);

      // Get audit metrics
      const eventCount = await auditTrailService.getEventCount();
      const integrityResult = await auditTrailService.verifyIntegrity();
      const complianceMetrics = await complianceModeService.getComplianceMetrics();

      // Build response
      const response = {
        correlationId,
        timestamp: new Date().toISOString(),
        audit: {
          totalEvents: eventCount,
          lastEventHash: integrityResult.lastEventHash,
          integrityValid: integrityResult.isValid,
          brokenAtEventId: integrityResult.brokenAtEventId || null,
        },
        compliance: {
          complianceModeEnabled: complianceMetrics.complianceEnabled,
          status: complianceMetrics.status,
          lastIntegrityCheck: complianceMetrics.lastIntegrityCheck,
          webhookLocked: complianceMetrics.webhookLocked,
          breachDetectedAt: complianceMetrics.breachDetectedAt,
          breachReason: complianceMetrics.breachReason,
        },
      };

      res.status(200).json(response);

      // Log audit status check
      console.log(
        `[ComplianceEndpoint] Audit status requested - Integrity: ${integrityResult.isValid}, Events: ${eventCount}`
      );
    } catch (error) {
      console.error("[ComplianceEndpoint] Error getting audit status:", error);
      res.status(500).json({
        error: "Failed to retrieve audit status",
        correlationId: getCorrelationId(req),
      });
    }
  };
}

/**
 * GET /internal/audit/events
 * Returns audit events within time range
 * Query params: startTime, endTime (milliseconds), limit (default 100)
 */
export async function getAuditEvents(auditTrailService: AuditTrailService) {
  return async (req: Request, res: Response) => {
    try {
      const correlationId = getCorrelationId(req);
      const startTime = parseInt(req.query.startTime as string) || Date.now() - 24 * 60 * 60 * 1000; // Default: last 24h
      const endTime = parseInt(req.query.endTime as string) || Date.now();
      const limit = parseInt(req.query.limit as string) || 100;

      // Validate time range
      if (startTime >= endTime) {
        return res.status(400).json({
          error: "Invalid time range: startTime must be before endTime",
          correlationId,
        });
      }

      // Get events
      const events = await auditTrailService.getEventsByTimeRange(startTime, endTime, limit);

      res.status(200).json({
        correlationId,
        timestamp: new Date().toISOString(),
        query: {
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          limit,
        },
        eventCount: events.length,
        events,
      });
    } catch (error) {
      console.error("[ComplianceEndpoint] Error getting audit events:", error);
      res.status(500).json({
        error: "Failed to retrieve audit events",
        correlationId: getCorrelationId(req),
      });
    }
  };
}

/**
 * GET /internal/audit/trace/:correlationId
 * Returns all events for a specific correlation ID (end-to-end trace)
 */
export async function traceCorrelationId(auditTrailService: AuditTrailService) {
  return async (req: Request, res: Response) => {
    try {
      const correlationId = getCorrelationId(req);
      const targetCorrelationId = req.params.correlationId;

      if (!targetCorrelationId) {
        return res.status(400).json({
          error: "Missing correlationId parameter",
          correlationId,
        });
      }

      // Get events for correlation ID
      const events = await auditTrailService.getEventsByCorrelationId(targetCorrelationId);

      res.status(200).json({
        correlationId,
        timestamp: new Date().toISOString(),
        targetCorrelationId,
        eventCount: events.length,
        events,
      });
    } catch (error) {
      console.error("[ComplianceEndpoint] Error tracing correlation ID:", error);
      res.status(500).json({
        error: "Failed to trace correlation ID",
        correlationId: getCorrelationId(req),
      });
    }
  };
}

/**
 * POST /internal/audit/unlock
 * Manually unlock webhook endpoint after security breach
 * Requires confirmation and internal API key
 */
export async function unlockWebhookEndpoint(complianceModeService: ComplianceModeService) {
  return async (req: Request, res: Response) => {
    try {
      const correlationId = getCorrelationId(req);
      const { confirmation } = req.body;

      // Require explicit confirmation
      if (confirmation !== "UNLOCK_WEBHOOK_ENDPOINT") {
        return res.status(400).json({
          error: "Invalid confirmation. Must provide confirmation: 'UNLOCK_WEBHOOK_ENDPOINT'",
          correlationId,
        });
      }

      // Unlock endpoint
      await complianceModeService.unlockWebhookEndpoint();

      res.status(200).json({
        correlationId,
        timestamp: new Date().toISOString(),
        message: "Webhook endpoint unlocked",
        status: complianceModeService.getComplianceStatus(),
      });

      console.log("[ComplianceEndpoint] Webhook endpoint unlocked by administrator");
    } catch (error) {
      console.error("[ComplianceEndpoint] Error unlocking webhook endpoint:", error);
      res.status(500).json({
        error: "Failed to unlock webhook endpoint",
        correlationId: getCorrelationId(req),
      });
    }
  };
}

/**
 * Register compliance endpoints
 */
export function registerComplianceEndpoints(
  app: any,
  auditTrailService: AuditTrailService,
  complianceModeService: ComplianceModeService
) {
  // Apply API key verification to all compliance endpoints
  app.use("/internal/audit", verifyInternalApiKey);

  // Status endpoint
  app.get("/internal/audit/status", getAuditStatus(auditTrailService, complianceModeService));

  // Events endpoint
  app.get("/internal/audit/events", getAuditEvents(auditTrailService));

  // Trace endpoint
  app.get("/internal/audit/trace/:correlationId", traceCorrelationId(auditTrailService));

  // Unlock endpoint
  app.post("/internal/audit/unlock", unlockWebhookEndpoint(complianceModeService));

  console.log("[ComplianceEndpoint] Compliance endpoints registered");
}
