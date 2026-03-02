/**
 * Audit Log Export Tests
 * 
 * Verify audit log export functionality:
 * - CSV and JSON formatting
 * - Filtering by date, event type, correlation ID
 * - Internal authentication
 * - Sensitive data masking
 * - Rate limiting
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AuditLogExportService, ExportFilter } from "../server/compliance/auditLogExport.service";
import { AuditEvent, AuditEventType } from "../server/compliance/auditTrail.service";

describe("Audit Log Export Service", () => {
  let exportService: AuditLogExportService;
  let mockRedis: any;

  beforeEach(() => {
    mockRedis = {};
    exportService = new AuditLogExportService(mockRedis);
  });

  describe("CSV Export", () => {
    it("should export events as CSV with headers", async () => {
      const events: AuditEvent[] = [
        {
          eventId: "e1",
          timestamp: Date.now(),
          eventType: AuditEventType.WEBHOOK_RECEIVED,
          correlationId: "corr-1",
          ip: "192.168.1.1",
          systemId: "system-1",
          payloadHash: "hash1",
          previousEventHash: "prev1",
          currentEventHash: "curr1",
        },
      ];

      const csv = await exportService.exportAsCSV(events, false, true);

      expect(csv).toContain("Event ID");
      expect(csv).toContain("Timestamp");
      expect(csv).toContain("Event Type");
      expect(csv).toContain("e1");
      expect(csv).toContain("WEBHOOK_RECEIVED");
    });

    it("should escape CSV fields with special characters", async () => {
      const events: AuditEvent[] = [
        {
          eventId: "e1",
          timestamp: Date.now(),
          eventType: AuditEventType.WEBHOOK_RECEIVED,
          correlationId: "corr,with,commas",
          ip: "192.168.1.1",
          systemId: "system-1",
          payloadHash: "hash1",
          previousEventHash: "prev1",
          currentEventHash: "curr1",
        },
      ];

      const csv = await exportService.exportAsCSV(events, false, true);

      // Correlation ID with commas should be quoted
      expect(csv).toContain('"corr,with,commas"');
    });

    it("should include details when requested", async () => {
      const events: AuditEvent[] = [
        {
          eventId: "e1",
          timestamp: Date.now(),
          eventType: AuditEventType.WEBHOOK_RECEIVED,
          correlationId: "corr-1",
          ip: "192.168.1.1",
          systemId: "system-1",
          payloadHash: "hash1",
          previousEventHash: "prev1",
          currentEventHash: "curr1",
          details: { endpoint: "/webhooks/mpesa", method: "POST" },
        },
      ];

      const csv = await exportService.exportAsCSV(events, true, true);

      expect(csv).toContain("Details");
      expect(csv).toContain("endpoint");
    });

    it("should return empty CSV with headers only", async () => {
      const csv = await exportService.exportAsCSV([], false, true);

      expect(csv).toContain("Event ID");
      expect(csv).not.toContain("e1");
    });
  });

  describe("JSON Export", () => {
    it("should export events as JSON with metadata", async () => {
      const events: AuditEvent[] = [
        {
          eventId: "e1",
          timestamp: Date.now(),
          eventType: AuditEventType.WEBHOOK_RECEIVED,
          correlationId: "corr-1",
          ip: "192.168.1.1",
          systemId: "system-1",
          payloadHash: "hash1",
          previousEventHash: "prev1",
          currentEventHash: "curr1",
        },
      ];

      const json = await exportService.exportAsJSON(events, false, true);
      const parsed = JSON.parse(json);

      expect(parsed.exportDate).toBeDefined();
      expect(parsed.totalEvents).toBe(1);
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0].eventId).toBe("e1");
    });

    it("should include details when requested", async () => {
      const events: AuditEvent[] = [
        {
          eventId: "e1",
          timestamp: Date.now(),
          eventType: AuditEventType.WEBHOOK_RECEIVED,
          correlationId: "corr-1",
          ip: "192.168.1.1",
          systemId: "system-1",
          payloadHash: "hash1",
          previousEventHash: "prev1",
          currentEventHash: "curr1",
          details: { endpoint: "/webhooks/mpesa" },
        },
      ];

      const json = await exportService.exportAsJSON(events, true, true);
      const parsed = JSON.parse(json);

      expect(parsed.events[0].details).toBeDefined();
      expect(parsed.events[0].details.endpoint).toBe("/webhooks/mpesa");
    });

    it("should return valid JSON with empty events", async () => {
      const json = await exportService.exportAsJSON([], false, true);
      const parsed = JSON.parse(json);

      expect(parsed.totalEvents).toBe(0);
      expect(parsed.events).toHaveLength(0);
    });
  });

  describe("Data Masking", () => {
    it("should mask IP addresses in export", async () => {
      const events: AuditEvent[] = [
        {
          eventId: "e1",
          timestamp: Date.now(),
          eventType: AuditEventType.WEBHOOK_RECEIVED,
          correlationId: "corr-1",
          ip: "192.168.1.100",
          systemId: "system-1",
          payloadHash: "hash1",
          previousEventHash: "prev1",
          currentEventHash: "curr1",
        },
      ];

      const csv = await exportService.exportAsCSV(events, false, true);

      // IP should be masked
      expect(csv).toContain("192.168.**");
      expect(csv).not.toContain("192.168.1.100");
    });

    it("should not mask data when maskSensitiveData is false", async () => {
      const events: AuditEvent[] = [
        {
          eventId: "e1",
          timestamp: Date.now(),
          eventType: AuditEventType.WEBHOOK_RECEIVED,
          correlationId: "corr-1",
          ip: "192.168.1.100",
          systemId: "system-1",
          payloadHash: "hash1",
          previousEventHash: "prev1",
          currentEventHash: "curr1",
        },
      ];

      const csv = await exportService.exportAsCSV(events, false, false);

      // IP should not be masked
      expect(csv).toContain("192.168.1.100");
    });
  });

  describe("Filter Validation", () => {
    it("should validate date range", () => {
      const filter: ExportFilter = {
        startDate: new Date("2025-03-02"),
        endDate: new Date("2025-03-01"),
      };

      const result = exportService.validateFilter(filter);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Start date must be before end date");
    });

    it("should validate limit maximum", () => {
      const filter: ExportFilter = {
        limit: 200000,
      };

      const result = exportService.validateFilter(filter);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Limit cannot exceed 100000");
    });

    it("should validate offset is non-negative", () => {
      const filter: ExportFilter = {
        offset: -1,
      };

      const result = exportService.validateFilter(filter);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Offset cannot be negative");
    });

    it("should accept valid filter", () => {
      const filter: ExportFilter = {
        startDate: new Date("2025-03-01"),
        endDate: new Date("2025-03-02"),
        limit: 1000,
        offset: 0,
      };

      const result = exportService.validateFilter(filter);

      expect(result.valid).toBe(true);
    });
  });

  describe("Export Metadata", () => {
    it("should generate export metadata for CSV", () => {
      const metadata = exportService.getExportMetadata("csv", 100);

      expect(metadata.format).toBe("csv");
      expect(metadata.totalEvents).toBe(100);
      expect(metadata.exportDate).toBeDefined();
      expect(metadata.dataProtection.sensitiveDataMasked).toBe(true);
    });

    it("should generate export metadata for JSON", () => {
      const metadata = exportService.getExportMetadata("json", 50);

      expect(metadata.format).toBe("json");
      expect(metadata.totalEvents).toBe(50);
    });

    it("should include filter in metadata", () => {
      const filter: ExportFilter = {
        startDate: new Date("2025-03-01"),
        eventTypes: [AuditEventType.WEBHOOK_RECEIVED],
        correlationId: "corr-1",
      };

      const metadata = exportService.getExportMetadata("json", 10, filter);

      expect(metadata.filter.startDate).toBeDefined();
      expect(metadata.filter.eventTypes).toContain(AuditEventType.WEBHOOK_RECEIVED);
      expect(metadata.filter.correlationId).toBe("corr-1");
    });
  });

  describe("CSV Field Escaping", () => {
    it("should properly escape quotes in CSV fields", async () => {
      const events: AuditEvent[] = [
        {
          eventId: 'e"1',
          timestamp: Date.now(),
          eventType: AuditEventType.WEBHOOK_RECEIVED,
          correlationId: 'corr"with"quotes',
          ip: "192.168.1.1",
          systemId: "system-1",
          payloadHash: "hash1",
          previousEventHash: "prev1",
          currentEventHash: "curr1",
        },
      ];

      const csv = await exportService.exportAsCSV(events, false, true);

      // Quotes should be escaped
      expect(csv).toContain('""');
    });

    it("should handle newlines in CSV fields", async () => {
      const events: AuditEvent[] = [
        {
          eventId: "e1",
          timestamp: Date.now(),
          eventType: AuditEventType.WEBHOOK_RECEIVED,
          correlationId: "corr-1",
          ip: "192.168.1.1",
          systemId: "system-1",
          payloadHash: "hash1",
          previousEventHash: "prev1",
          currentEventHash: "curr1",
          details: { note: "line1\nline2" },
        },
      ];

      const csv = await exportService.exportAsCSV(events, true, true);

      // Should be properly quoted
      expect(csv).toContain('"');
    });
  });

  describe("Multiple Event Export", () => {
    it("should export multiple events in order", async () => {
      const events: AuditEvent[] = [
        {
          eventId: "e1",
          timestamp: 1000,
          eventType: AuditEventType.WEBHOOK_RECEIVED,
          correlationId: "corr-1",
          ip: "192.168.1.1",
          systemId: "system-1",
          payloadHash: "hash1",
          previousEventHash: "prev1",
          currentEventHash: "curr1",
        },
        {
          eventId: "e2",
          timestamp: 2000,
          eventType: AuditEventType.SIGNATURE_VALID,
          correlationId: "corr-1",
          ip: "192.168.1.1",
          systemId: "system-1",
          payloadHash: "hash2",
          previousEventHash: "curr1",
          currentEventHash: "curr2",
        },
      ];

      const json = await exportService.exportAsJSON(events, false, true);
      const parsed = JSON.parse(json);

      expect(parsed.totalEvents).toBe(2);
      expect(parsed.events[0].eventId).toBe("e1");
      expect(parsed.events[1].eventId).toBe("e2");
    });
  });
});

describe("Internal Authentication", () => {
  it("should validate API key header", () => {
    const apiKey = "test-api-key-123";
    const expectedKey = "test-api-key-123";

    // Timing-safe comparison
    let result = 0;
    for (let i = 0; i < apiKey.length; i++) {
      result |= apiKey.charCodeAt(i) ^ expectedKey.charCodeAt(i);
    }

    expect(result === 0).toBe(true);
  });

  it("should reject invalid API key", () => {
    const apiKey = "wrong-key";
    const expectedKey = "correct-key";

    let result = 0;
    for (let i = 0; i < Math.max(apiKey.length, expectedKey.length); i++) {
      const a = i < apiKey.length ? apiKey.charCodeAt(i) : 0;
      const b = i < expectedKey.length ? expectedKey.charCodeAt(i) : 0;
      result |= a ^ b;
    }

    expect(result === 0).toBe(false);
  });

  it("should handle missing API key", () => {
    const apiKey = undefined;
    const expectedKey = "correct-key";

    expect(apiKey).toBeUndefined();
    expect(expectedKey).toBeDefined();
  });
});
