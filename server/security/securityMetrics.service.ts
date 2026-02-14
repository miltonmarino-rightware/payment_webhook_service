/**
 * Security Metrics Service
 *
 * Provides structured security event logging and metrics collection
 * for monitoring and auditing the Internal Payment Orchestrator.
 */

/**
 * Security event types
 */
export enum SecurityEventType {
  RATE_LIMIT_TRIGGERED = "RATE_LIMIT_TRIGGERED",
  RATE_LIMIT_BLOCKED = "RATE_LIMIT_BLOCKED",
  SIGNATURE_FAILURE = "SIGNATURE_FAILURE",
  SIGNATURE_FAILURE_ESCALATION = "SIGNATURE_FAILURE_ESCALATION",
  REPLAY_ATTEMPT = "REPLAY_ATTEMPT",
  REPLAY_ATTEMPT_BLOCKED = "REPLAY_ATTEMPT_BLOCKED",
  CIRCUIT_BREAKER_OPENED = "CIRCUIT_BREAKER_OPENED",
  CIRCUIT_BREAKER_CLOSED = "CIRCUIT_BREAKER_CLOSED",
  ABUSE_DETECTED = "ABUSE_DETECTED",
  CRITICAL_ABUSE_DETECTED = "CRITICAL_ABUSE_DETECTED",
  IP_BLOCKED = "IP_BLOCKED",
  IP_UNBLOCKED = "IP_UNBLOCKED",
}

/**
 * Security event structure
 */
export interface SecurityEvent {
  eventType: SecurityEventType;
  timestamp: Date;
  ip?: string;
  systemId?: string;
  transactionId?: string;
  abuseLevel?: string;
  abuseScore?: number;
  abuseFactors?: string[];
  details: Record<string, unknown>;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

/**
 * Security metrics snapshot
 */
export interface SecurityMetricsSnapshot {
  timestamp: Date;
  blockedIPs: number;
  openCircuitBreakers: number;
  activeSignatureFailures: number;
  totalRateLimitEvents: number;
  totalAbuseDetections: number;
  criticalAbuseCount: number;
  topBlockedIPs: Array<{ ip: string; blockCount: number }>;
  topFailingSystems: Array<{ systemId: string; failureCount: number }>;
  signatureFailureRate: number;
  replayAttemptRate: number;
  notificationFailureRate: number;
}

/**
 * Security metrics collector
 */
export class SecurityMetricsService {
  private events: SecurityEvent[] = [];
  private eventCounts: Map<SecurityEventType, number> = new Map();
  private ipBlockCounts: Map<string, number> = new Map();
  private systemFailureCounts: Map<string, number> = new Map();
  private maxEventsInMemory: number = 10000;

  constructor(maxEventsInMemory: number = 10000) {
    this.maxEventsInMemory = maxEventsInMemory;

    // Initialize event counters
    Object.values(SecurityEventType).forEach((eventType) => {
      this.eventCounts.set(eventType, 0);
    });
  }

  /**
   * Log a security event
   *
   * @param event Security event to log
   */
  logEvent(event: SecurityEvent): void {
    // Add timestamp if not provided
    if (!event.timestamp) {
      event.timestamp = new Date();
    }

    // Add to events array
    this.events.push(event);

    // Trim if exceeds max size
    if (this.events.length > this.maxEventsInMemory) {
      this.events = this.events.slice(-this.maxEventsInMemory);
    }

    // Update counters
    const count = this.eventCounts.get(event.eventType) || 0;
    this.eventCounts.set(event.eventType, count + 1);

    // Track IP blocks
    if (event.ip && event.eventType === SecurityEventType.IP_BLOCKED) {
      const blockCount = this.ipBlockCounts.get(event.ip) || 0;
      this.ipBlockCounts.set(event.ip, blockCount + 1);
    }

    // Track system failures
    if (event.systemId && event.eventType === SecurityEventType.CIRCUIT_BREAKER_OPENED) {
      const failureCount = this.systemFailureCounts.get(event.systemId) || 0;
      this.systemFailureCounts.set(event.systemId, failureCount + 1);
    }

    // Log to console with severity coloring
    this.logToConsole(event);
  }

  /**
   * Log event to console with appropriate formatting
   *
   * @param event Security event
   */
  private logToConsole(event: SecurityEvent): void {
    const prefix = `[SECURITY] [${event.severity}]`;
    const timestamp = event.timestamp.toISOString();
    const message = `${prefix} ${event.eventType} at ${timestamp}`;

    switch (event.severity) {
      case "CRITICAL":
        console.error(message, event);
        break;
      case "HIGH":
        console.warn(message, event);
        break;
      case "MEDIUM":
        console.log(message, event);
        break;
      case "LOW":
        console.debug(message, event);
        break;
    }
  }

  /**
   * Get current metrics snapshot
   *
   * @param blockedIPsCount Number of currently blocked IPs
   * @param openCircuitBreakersCount Number of open circuit breakers
   * @param activeSignatureFailuresCount Number of active signature failures
   * @returns Metrics snapshot
   */
  getMetricsSnapshot(
    blockedIPsCount: number = 0,
    openCircuitBreakersCount: number = 0,
    activeSignatureFailuresCount: number = 0
  ): SecurityMetricsSnapshot {
    // Get top blocked IPs
    const topBlockedIPs = Array.from(this.ipBlockCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ip, blockCount]) => ({ ip, blockCount }));

    // Get top failing systems
    const topFailingSystems = Array.from(this.systemFailureCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([systemId, failureCount]) => ({ systemId, failureCount }));

    // Calculate rates
    const totalRateLimitEvents =
      (this.eventCounts.get(SecurityEventType.RATE_LIMIT_TRIGGERED) || 0) +
      (this.eventCounts.get(SecurityEventType.RATE_LIMIT_BLOCKED) || 0);

    const totalAbuseDetections =
      (this.eventCounts.get(SecurityEventType.ABUSE_DETECTED) || 0) +
      (this.eventCounts.get(SecurityEventType.CRITICAL_ABUSE_DETECTED) || 0);

    const criticalAbuseCount = this.eventCounts.get(SecurityEventType.CRITICAL_ABUSE_DETECTED) || 0;

    const signatureFailures = this.eventCounts.get(SecurityEventType.SIGNATURE_FAILURE) || 0;
    const signatureFailureRate = this.events.length > 0 ? signatureFailures / this.events.length : 0;

    const replayAttempts = this.eventCounts.get(SecurityEventType.REPLAY_ATTEMPT) || 0;
    const replayAttemptRate = this.events.length > 0 ? replayAttempts / this.events.length : 0;

    const notificationFailures = this.systemFailureCounts.size;
    const notificationFailureRate = this.events.length > 0 ? notificationFailures / this.events.length : 0;

    return {
      timestamp: new Date(),
      blockedIPs: blockedIPsCount,
      openCircuitBreakers: openCircuitBreakersCount,
      activeSignatureFailures: activeSignatureFailuresCount,
      totalRateLimitEvents,
      totalAbuseDetections,
      criticalAbuseCount,
      topBlockedIPs,
      topFailingSystems,
      signatureFailureRate,
      replayAttemptRate,
      notificationFailureRate,
    };
  }

  /**
   * Get events filtered by type
   *
   * @param eventType Event type to filter
   * @param limit Maximum number of events to return
   * @returns Filtered events
   */
  getEventsByType(eventType: SecurityEventType, limit: number = 100): SecurityEvent[] {
    return this.events
      .filter((e) => e.eventType === eventType)
      .slice(-limit)
      .reverse();
  }

  /**
   * Get events for an IP address
   *
   * @param ip IP address
   * @param limit Maximum number of events to return
   * @returns Events for IP
   */
  getEventsForIP(ip: string, limit: number = 100): SecurityEvent[] {
    return this.events
      .filter((e) => e.ip === ip)
      .slice(-limit)
      .reverse();
  }

  /**
   * Get events for a system
   *
   * @param systemId System ID
   * @param limit Maximum number of events to return
   * @returns Events for system
   */
  getEventsForSystem(systemId: string, limit: number = 100): SecurityEvent[] {
    return this.events
      .filter((e) => e.systemId === systemId)
      .slice(-limit)
      .reverse();
  }

  /**
   * Get events for a transaction
   *
   * @param transactionId Transaction ID
   * @param limit Maximum number of events to return
   * @returns Events for transaction
   */
  getEventsForTransaction(transactionId: string, limit: number = 100): SecurityEvent[] {
    return this.events
      .filter((e) => e.transactionId === transactionId)
      .slice(-limit)
      .reverse();
  }

  /**
   * Get recent critical events
   *
   * @param limit Maximum number of events to return
   * @returns Recent critical events
   */
  getRecentCriticalEvents(limit: number = 50): SecurityEvent[] {
    return this.events
      .filter((e) => e.severity === "CRITICAL")
      .slice(-limit)
      .reverse();
  }

  /**
   * Get event count for a type
   *
   * @param eventType Event type
   * @returns Event count
   */
  getEventCount(eventType: SecurityEventType): number {
    return this.eventCounts.get(eventType) || 0;
  }

  /**
   * Get total event count
   *
   * @returns Total event count
   */
  getTotalEventCount(): number {
    return this.events.length;
  }

  /**
   * Clear all events and counters
   */
  clearAll(): void {
    this.events = [];
    this.eventCounts.clear();
    this.ipBlockCounts.clear();
    this.systemFailureCounts.clear();

    Object.values(SecurityEventType).forEach((eventType) => {
      this.eventCounts.set(eventType, 0);
    });
  }

  /**
   * Export metrics as JSON
   *
   * @returns JSON representation of metrics
   */
  toJSON(): Record<string, unknown> {
    return {
      totalEvents: this.events.length,
      eventCounts: Object.fromEntries(this.eventCounts),
      ipBlockCounts: Object.fromEntries(this.ipBlockCounts),
      systemFailureCounts: Object.fromEntries(this.systemFailureCounts),
      recentEvents: this.events.slice(-100),
    };
  }
}

/**
 * Create security metrics service
 *
 * @param maxEventsInMemory Maximum events to keep in memory
 * @returns SecurityMetricsService instance
 */
export function createSecurityMetricsService(maxEventsInMemory?: number): SecurityMetricsService {
  return new SecurityMetricsService(maxEventsInMemory);
}
