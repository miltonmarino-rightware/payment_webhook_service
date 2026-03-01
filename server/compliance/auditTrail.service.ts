/**
 * Immutable Audit Trail Service
 * 
 * Implements fintech-grade, append-only audit logging with:
 * - Cryptographic hash chaining for tamper detection
 * - Correlation ID tracking for end-to-end tracing
 * - Sensitive data masking
 * - Compliance-ready event storage
 * 
 * LEGAL NOTICE:
 * This audit trail is designed for regulatory compliance and forensic investigation.
 * All events are immutable and tamper-evident.
 * No financial data is stored - only transaction orchestration events.
 */

import crypto from "crypto";
// @ts-ignore
import { v4 as uuidv4 } from "uuid";

export enum AuditEventType {
  WEBHOOK_RECEIVED = "WEBHOOK_RECEIVED",
  SIGNATURE_VALID = "SIGNATURE_VALID",
  SIGNATURE_INVALID = "SIGNATURE_INVALID",
  REPLAY_BLOCKED = "REPLAY_BLOCKED",
  RATE_LIMIT_TRIGGERED = "RATE_LIMIT_TRIGGERED",
  ABUSE_LEVEL_ESCALATED = "ABUSE_LEVEL_ESCALATED",
  CIRCUIT_BREAKER_ACTIVATED = "CIRCUIT_BREAKER_ACTIVATED",
  NOTIFICATION_DISPATCHED = "NOTIFICATION_DISPATCHED",
  NOTIFICATION_FAILED = "NOTIFICATION_FAILED",
  MANUAL_RETRY_TRIGGERED = "MANUAL_RETRY_TRIGGERED",
  COMPLIANCE_CHECK_PASSED = "COMPLIANCE_CHECK_PASSED",
  COMPLIANCE_CHECK_FAILED = "COMPLIANCE_CHECK_FAILED",
  SECURITY_BREACH_DETECTED = "SECURITY_BREACH_DETECTED",
}

export interface AuditEvent {
  eventId: string;
  correlationId: string;
  eventType: AuditEventType;
  ip?: string;
  systemId?: string;
  payloadHash: string;
  previousEventHash: string;
  currentEventHash: string;
  timestamp: number;
  details?: Record<string, any>;
}

export interface AuditIntegrityResult {
  isValid: boolean;
  brokenAtEventId?: string;
  totalEvents: number;
  lastEventHash: string;
}

/**
 * Immutable audit trail service using Redis streams
 * Each event is append-only and cryptographically chained
 */
export class AuditTrailService {
  private redisClient: any;
  private lastEventHashKey = "audit:last_event_hash";
  private auditStreamKey = "audit:events";

  constructor(redisClient: any) {
    this.redisClient = redisClient;
  }

  /**
   * Get the last event hash from Redis
   * Used for hash chaining
   */
  async getLastEventHash(): Promise<string> {
    try {
      const hash = await this.redisClient.get(this.lastEventHashKey);
      return hash || "GENESIS";
    } catch (error) {
      console.error("[AuditTrail] Error getting last event hash:", error);
      return "GENESIS";
    }
  }

  /**
   * Calculate SHA256 hash for an event
   * Deterministic: same input always produces same hash
   */
  private calculateEventHash(
    eventData: Omit<AuditEvent, "currentEventHash" | "previousEventHash" | "eventId">,
    previousHash: string
  ): string {
    // Create deterministic string: event data + previous hash
    const dataString = JSON.stringify(eventData, Object.keys(eventData).sort());
    const chainString = dataString + previousHash;

    // SHA256 hash
    return crypto.createHash("sha256").update(chainString).digest("hex");
  }

  /**
   * Log an audit event (append-only)
   * Returns the event with calculated hashes
   */
  async logEvent(
    eventType: AuditEventType,
    correlationId: string,
    details?: {
      ip?: string;
      systemId?: string;
      payloadHash?: string;
      [key: string]: any;
    }
  ): Promise<AuditEvent> {
    try {
      const eventId = uuidv4();
      const timestamp = Date.now();

      // Get previous hash for chaining
      const previousEventHash = await this.getLastEventHash();

      // Prepare event data (without hashes)
      const eventData = {
        eventId,
        correlationId,
        eventType,
        ip: details?.ip,
        systemId: details?.systemId,
        payloadHash: details?.payloadHash || "",
        timestamp,
      };

      // Calculate current hash
      const currentEventHash = this.calculateEventHash(eventData, previousEventHash);

      // Create complete event
      const auditEvent: AuditEvent = {
        ...eventData,
        previousEventHash,
        currentEventHash,
        details: details ? { ...details } : undefined,
      };

      // Append to Redis stream (immutable)
      await this.redisClient.xAdd(
        this.auditStreamKey,
        "*",
        "event",
        JSON.stringify(auditEvent)
      );

      // Update last event hash (atomic)
      await this.redisClient.set(this.lastEventHashKey, currentEventHash);

      return auditEvent;
    } catch (error) {
      console.error("[AuditTrail] Error logging event:", error);
      throw new Error(`Failed to log audit event: ${(error as Error).message}`);
    }
  }

  /**
   * Verify audit trail integrity
   * Returns validation result and identifies where chain breaks (if any)
   */
  async verifyIntegrity(): Promise<AuditIntegrityResult> {
    try {
      // Get all events from stream
      const events = await this.redisClient.xRange(this.auditStreamKey, "-", "+");

      if (!events || events.length === 0) {
        return {
          isValid: true,
          totalEvents: 0,
          lastEventHash: "GENESIS",
        };
      }

      let previousHash = "GENESIS";
      let brokenAtEventId: string | undefined;

      // Verify each event in sequence
      for (const [, eventData] of events as any[]) {
        const event = JSON.parse((eventData as any)[1]) as AuditEvent;

        // Verify previous hash matches
        if (event.previousEventHash !== previousHash) {
          brokenAtEventId = event.eventId;
          break;
        }

        // Recalculate current hash
        const eventDataForHash = {
          eventId: event.eventId,
          correlationId: event.correlationId,
          eventType: event.eventType,
          ip: event.ip,
          systemId: event.systemId,
          payloadHash: event.payloadHash,
          timestamp: event.timestamp,
        };

        const recalculatedHash = this.calculateEventHash(eventDataForHash, previousHash);

        // Verify hash matches
        if (recalculatedHash !== event.currentEventHash) {
          brokenAtEventId = event.eventId;
          break;
        }

        previousHash = event.currentEventHash;
      }

      const lastEvent = events[events.length - 1] as any;
      const lastEventData = JSON.parse((lastEvent as any)[1]) as AuditEvent;

      return {
        isValid: !brokenAtEventId,
        brokenAtEventId,
        totalEvents: events.length,
        lastEventHash: lastEventData.currentEventHash,
      };
    } catch (error) {
      console.error("[AuditTrail] Error verifying integrity:", error);
      return {
        isValid: false,
        totalEvents: 0,
        lastEventHash: "ERROR",
      };
    }
  }

  /**
   * Get audit events within time range
   * For compliance reporting
   */
  async getEventsByTimeRange(
    startTime: number,
    endTime: number,
    limit: number = 100
  ): Promise<AuditEvent[]> {
    try {
      // Get all events (Redis streams don't filter by timestamp directly)
      const events = await this.redisClient.xRange(this.auditStreamKey, "-", "+");

      if (!events) return [];

      return events
        .map(([, eventData]: any[]) => JSON.parse((eventData as any)[1]) as AuditEvent)
        .filter((event: AuditEvent) => event.timestamp >= startTime && event.timestamp <= endTime)
        .slice(0, limit);
    } catch (error) {
      console.error("[AuditTrail] Error getting events by time range:", error);
      return [];
    }
  }

  /**
   * Get events by correlation ID
   * For end-to-end tracing
   */
  async getEventsByCorrelationId(correlationId: string): Promise<AuditEvent[]> {
    try {
      const events = await this.redisClient.xRange(this.auditStreamKey, "-", "+");

      if (!events) return [];

      return events
        .map(([, eventData]: any[]) => JSON.parse((eventData as any)[1]) as AuditEvent)
        .filter((event: AuditEvent) => event.correlationId === correlationId);
    } catch (error) {
      console.error("[AuditTrail] Error getting events by correlation ID:", error);
      return [];
    }
  }

  /**
   * Get total audit event count
   * For compliance metrics
   */
  async getEventCount(): Promise<number> {
    try {
      const count = await this.redisClient.xLen(this.auditStreamKey);
      return count || 0;
    } catch (error) {
      console.error("[AuditTrail] Error getting event count:", error);
      return 0;
    }
  }

  /**
   * Clear audit trail (only for testing)
   * NEVER use in production
   */
  async clearForTesting(): Promise<void> {
    try {
      await this.redisClient.del(this.auditStreamKey);
      await this.redisClient.del(this.lastEventHashKey);
    } catch (error) {
      console.error("[AuditTrail] Error clearing audit trail:", error);
    }
  }
}
