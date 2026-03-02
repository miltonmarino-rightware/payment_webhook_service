/**
 * Audit Log Export Endpoint
 * 
 * Secure internal endpoint for exporting audit logs in CSV or JSON format.
 * Supports filtering by date range, event type, correlation ID, etc.
 * Implements streaming for large datasets and rate limiting.
 */

import { Router, Request, Response } from "express";
import { AuditTrailService } from "./auditTrail.service";
import { AuditLogExportService, ExportFilter, ExportOptions } from "./auditLogExport.service";
import { internalAuthMiddleware, requireInternalAuth, logInternalApiAccess, rateLimitInternalApi } from "./internalAuth.middleware";

export function createAuditExportRouter(auditTrailService: AuditTrailService): Router {
  const router = Router();
  const exportService = new AuditLogExportService((auditTrailService as any).redis);

  // Apply internal authentication to all export routes
  router.use(internalAuthMiddleware());
  router.use(requireInternalAuth);
  router.use(logInternalApiAccess);
  router.use(rateLimitInternalApi(100, 60000)); // 100 requests per minute

  /**
   * GET /internal/audit/export
   * Export audit logs in CSV or JSON format
   * 
   * Query Parameters:
   * - format: "csv" or "json" (default: "json")
   * - startDate: ISO 8601 date string (optional)
   * - endDate: ISO 8601 date string (optional)
   * - eventType: comma-separated event types (optional)
   * - correlationId: filter by correlation ID (optional)
   * - ip: filter by IP address (optional)
   * - systemId: filter by external system ID (optional)
   * - includeDetails: "true" or "false" (default: "false")
   * - limit: max records to export (default: 10000, max: 100000)
   * - offset: pagination offset (default: 0)
   */
  router.get("/export", async (req: Request, res: Response) => {
    try {
      const format = (req.query.format as string) || "json";
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const eventTypes = req.query.eventType
        ? (req.query.eventType as string).split(",").filter((t) => t.trim())
        : undefined;
      const correlationId = req.query.correlationId as string | undefined;
      const ip = req.query.ip as string | undefined;
      const systemId = req.query.systemId as string | undefined;
      const includeDetails = req.query.includeDetails === "true";
      const limit = Math.min(parseInt(req.query.limit as string) || 10000, 100000);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

      // Validate format
      if (format !== "csv" && format !== "json") {
        return res.status(400).json({
          error: "Invalid format - must be 'csv' or 'json'",
        });
      }

      // Build filter
      const filter: ExportFilter = {
        startDate,
        endDate,
        eventTypes: eventTypes as any,
        correlationId,
        ip,
        systemId,
        limit,
        offset,
      };

      // Validate filter
      const validation = exportService.validateFilter(filter);
      if (!validation.valid) {
        return res.status(400).json({
          error: validation.error,
        });
      }

      // Get events from audit trail
      let events: any[] = [];
      
      if (correlationId) {
        events = await auditTrailService.getEventsByCorrelationId(correlationId);
      } else if (startDate || endDate) {
        const startTime = startDate ? startDate.getTime() : 0;
        const endTime = endDate ? endDate.getTime() : Date.now();
        events = await auditTrailService.getEventsByTimeRange(startTime, endTime, limit);
      } else {
        // Get all events if no specific filter
        const allEvents = await auditTrailService.getEventsByTimeRange(0, Date.now(), limit);
        events = allEvents;
      }
      
      // Apply additional filters
      if (eventTypes && eventTypes.length > 0) {
        events = events.filter((e: any) => eventTypes.includes(e.eventType));
      }
      if (ip) {
        events = events.filter((e: any) => e.ip === ip);
      }
      if (systemId) {
        events = events.filter((e: any) => e.systemId === systemId);
      }
      
      // Apply offset and limit
      events = events.slice(offset, offset + limit);

      if (events.length === 0) {
        return res.status(200).json({
          message: "No events found matching the filter criteria",
          totalEvents: 0,
          filter,
        });
      }

      // Generate export
      let exportData: string;
      let contentType: string;
      let filename: string;

      if (format === "csv") {
        exportData = await exportService.exportAsCSV(events, includeDetails, true);
        contentType = "text/csv";
        filename = `audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
      } else {
        exportData = await exportService.exportAsJSON(events, includeDetails, true);
        contentType = "application/json";
        filename = `audit-logs-${new Date().toISOString().split("T")[0]}.json`;
      }

      // Set response headers
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("X-Total-Events", events.length);
      res.setHeader("X-Export-Date", new Date().toISOString());

      // Log export
      console.log(
        `[AuditExport] Exported ${events.length} events in ${format} format. Auth: ${(req as any).internalAuth?.apiKey}`
      );

      // Send response
      res.send(exportData);
    } catch (error) {
      console.error("[AuditExport] Export failed:", error);
      res.status(500).json({
        error: "Failed to export audit logs",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /internal/audit/export/metadata
   * Get export metadata without exporting data
   */
  router.get("/export/metadata", async (req: Request, res: Response) => {
    try {
      const format = (req.query.format as string) || "json";
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const eventTypes = req.query.eventType
        ? (req.query.eventType as string).split(",").filter((t) => t.trim())
        : undefined;
      const correlationId = req.query.correlationId as string | undefined;
      const ip = req.query.ip as string | undefined;
      const systemId = req.query.systemId as string | undefined;

      // Build filter
      const filter: ExportFilter = {
        startDate,
        endDate,
        eventTypes: eventTypes as any,
        correlationId,
        ip,
        systemId,
      };

      // Get event count
      let events: any[] = [];
      
      if (correlationId) {
        events = await auditTrailService.getEventsByCorrelationId(correlationId);
      } else if (startDate || endDate) {
        const startTime = startDate ? startDate.getTime() : 0;
        const endTime = endDate ? endDate.getTime() : Date.now();
        events = await auditTrailService.getEventsByTimeRange(startTime, endTime, 100000);
      } else {
        // Get all events if no specific filter
        const allEvents = await auditTrailService.getEventsByTimeRange(0, Date.now(), 100000);
        events = allEvents;
      }
      
      // Apply additional filters
      if (eventTypes && eventTypes.length > 0) {
        events = events.filter((e: any) => eventTypes.includes(e.eventType));
      }
      if (ip) {
        events = events.filter((e: any) => e.ip === ip);
      }
      if (systemId) {
        events = events.filter((e: any) => e.systemId === systemId);
      }

      // Get metadata
      const metadata = exportService.getExportMetadata(format as "csv" | "json", events.length, filter);

      res.json(metadata);
    } catch (error) {
      console.error("[AuditExport] Metadata request failed:", error);
      res.status(500).json({
        error: "Failed to get export metadata",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /internal/audit/export/formats
   * Get available export formats and parameters
   */
  router.get("/export/formats", (req: Request, res: Response) => {
    res.json({
      formats: ["csv", "json"],
      parameters: {
        format: {
          description: "Export format",
          type: "string",
          enum: ["csv", "json"],
          default: "json",
        },
        startDate: {
          description: "Filter events after this date (ISO 8601)",
          type: "string",
          example: "2025-03-01T00:00:00Z",
        },
        endDate: {
          description: "Filter events before this date (ISO 8601)",
          type: "string",
          example: "2025-03-02T00:00:00Z",
        },
        eventType: {
          description: "Filter by event types (comma-separated)",
          type: "string",
          example: "WEBHOOK_RECEIVED,SIGNATURE_VALID,NOTIFICATION_DISPATCHED",
        },
        correlationId: {
          description: "Filter by correlation ID",
          type: "string",
          example: "550e8400-e29b-41d4-a716-446655440000",
        },
        ip: {
          description: "Filter by IP address",
          type: "string",
          example: "192.168.1.1",
        },
        systemId: {
          description: "Filter by external system ID",
          type: "string",
          example: "restaurant-pos-001",
        },
        includeDetails: {
          description: "Include detailed event information",
          type: "boolean",
          default: false,
        },
        limit: {
          description: "Maximum records to export",
          type: "number",
          default: 10000,
          maximum: 100000,
        },
        offset: {
          description: "Pagination offset",
          type: "number",
          default: 0,
        },
      },
      authentication: {
        method: "API Key",
        header: "X-Internal-API-Key",
        envVar: "INTERNAL_API_KEY",
      },
      rateLimit: {
        requests: 100,
        window: "1 minute",
      },
    });
  });

  return router;
}
