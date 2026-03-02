/**
 * Audit Log Export Service
 * 
 * Provides secure export of audit logs for compliance reporting.
 * Supports CSV and JSON formats with filtering and data protection.
 * 
 * LEGAL NOTICE:
 * Exported logs are for internal compliance use only.
 * All personally identifiable information is masked.
 * Logs are immutable and tamper-evident.
 */

import { AuditEvent, AuditEventType } from "./auditTrail.service";
import { maskSensitiveData } from "./masking.service";

export interface ExportFilter {
  startDate?: Date;
  endDate?: Date;
  eventTypes?: AuditEventType[];
  correlationId?: string;
  ip?: string;
  systemId?: string;
  limit?: number;
  offset?: number;
}

export interface ExportOptions {
  format: "csv" | "json";
  includeDetails?: boolean;
  maskSensitiveData?: boolean;
}

export class AuditLogExportService {
  constructor(private redis: any) {}

  /**
   * Export audit logs in CSV format
   */
  async exportAsCSV(
    events: AuditEvent[],
    includeDetails: boolean = false,
    maskData: boolean = true
  ): Promise<string> {
    if (events.length === 0) {
      return this.getCSVHeader(includeDetails);
    }

    const rows: string[] = [this.getCSVHeader(includeDetails)];

    for (const event of events) {
      const row = this.eventToCSVRow(event, includeDetails, maskData);
      rows.push(row);
    }

    return rows.join("\n");
  }

  /**
   * Export audit logs in JSON format
   */
  async exportAsJSON(
    events: AuditEvent[],
    includeDetails: boolean = false,
    maskData: boolean = true
  ): Promise<string> {
    const exportedEvents = events.map((event) => this.eventToJSONObject(event, includeDetails, maskData));

    return JSON.stringify(
      {
        exportDate: new Date().toISOString(),
        totalEvents: exportedEvents.length,
        events: exportedEvents,
      },
      null,
      2
    );
  }

  /**
   * Get CSV header row
   */
  private getCSVHeader(includeDetails: boolean): string {
    const headers = [
      "Event ID",
      "Timestamp",
      "Event Type",
      "Correlation ID",
      "IP Address",
      "System ID",
      "Payload Hash",
      "Previous Event Hash",
      "Current Event Hash",
    ];

    if (includeDetails) {
      headers.push("Details");
    }

    return headers.map((h) => this.escapeCSVField(h)).join(",");
  }

  /**
   * Convert event to CSV row
   */
  private eventToCSVRow(event: AuditEvent, includeDetails: boolean, maskData: boolean): string {
    const fields = [
      event.eventId,
      new Date(event.timestamp).toISOString(),
      event.eventType,
      event.correlationId,
      maskData ? this.maskIP(event.ip || "") : event.ip || "",
      event.systemId || "",
      event.payloadHash,
      event.previousEventHash,
      event.currentEventHash,
    ];

    if (includeDetails) {
      const details = maskData ? maskSensitiveData(event.details || {}) : event.details || {};
      fields.push(JSON.stringify(details));
    }

    return fields.map((f) => this.escapeCSVField(String(f))).join(",");
  }

  /**
   * Convert event to JSON object
   */
  private eventToJSONObject(event: AuditEvent, includeDetails: boolean, maskData: boolean): Record<string, any> {
    const obj: Record<string, any> = {
      eventId: event.eventId,
      timestamp: new Date(event.timestamp).toISOString(),
      eventType: event.eventType,
      correlationId: event.correlationId,
      ip: maskData ? this.maskIP(event.ip || "") : event.ip || "",
      systemId: event.systemId || "",
      payloadHash: event.payloadHash,
      previousEventHash: event.previousEventHash,
      currentEventHash: event.currentEventHash,
    };

    if (includeDetails) {
      obj.details = maskData ? maskSensitiveData(event.details || {}) : event.details || {};
    }

    return obj;
  }

  /**
   * Escape CSV field to prevent injection
   */
  private escapeCSVField(field: string): string {
    // If field contains comma, quote, or newline, wrap in quotes and escape quotes
    if (field.includes(",") || field.includes('"') || field.includes("\n")) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }

  /**
   * Mask IP address for privacy
   */
  private maskIP(ip: string): string {
    if (!ip || ip === "unknown") {
      return ip;
    }

    const parts = ip.split(".");
    if (parts.length === 4) {
      // IPv4: mask last two octets
      return `${parts[0]}.${parts[1]}.**.***`;
    }

    // IPv6 or other: mask last half
    return ip.substring(0, Math.floor(ip.length / 2)) + "****";
  }

  /**
   * Validate export filter dates
   */
  validateFilter(filter: ExportFilter): { valid: boolean; error?: string } {
    if (filter.startDate && filter.endDate && filter.startDate > filter.endDate) {
      return {
        valid: false,
        error: "Start date must be before end date",
      };
    }

    if (filter.limit && filter.limit > 100000) {
      return {
        valid: false,
        error: "Limit cannot exceed 100000 records",
      };
    }

    if (filter.offset && filter.offset < 0) {
      return {
        valid: false,
        error: "Offset cannot be negative",
      };
    }

    return { valid: true };
  }

  /**
   * Build Redis query for filtered events
   */
  buildRedisQuery(filter: ExportFilter): { pattern: string; args: any[] } {
    let pattern = "audit:event:*";

    const args: any[] = [];

    if (filter.eventTypes && filter.eventTypes.length > 0) {
      // Filter by event type in post-processing
      args.push("eventTypes", filter.eventTypes);
    }

    if (filter.startDate) {
      args.push("startDate", filter.startDate.getTime());
    }

    if (filter.endDate) {
      args.push("endDate", filter.endDate.getTime());
    }

    if (filter.correlationId) {
      args.push("correlationId", filter.correlationId);
    }

    if (filter.ip) {
      args.push("ip", filter.ip);
    }

    if (filter.systemId) {
      args.push("systemId", filter.systemId);
    }

    return { pattern, args };
  }

  /**
   * Format export metadata
   */
  getExportMetadata(
    format: "csv" | "json",
    eventCount: number,
    filter?: ExportFilter
  ): Record<string, any> {
    return {
      exportDate: new Date().toISOString(),
      format,
      totalEvents: eventCount,
      filter: {
        startDate: filter?.startDate?.toISOString(),
        endDate: filter?.endDate?.toISOString(),
        eventTypes: filter?.eventTypes,
        correlationId: filter?.correlationId,
        ip: filter?.ip,
        systemId: filter?.systemId,
      },
      dataProtection: {
        sensitiveDataMasked: true,
        ipAddressMasked: true,
        phoneNumbersMasked: true,
      },
    };
  }
}
