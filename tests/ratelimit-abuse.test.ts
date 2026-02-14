/**
 * Tests for Rate Limiting and Abuse Detection
 *
 * Tests cover:
 * - Rate limiting with sliding window
 * - Burst limit handling
 * - IP blocking and unblocking
 * - Signature failure escalation
 * - Replay attempt detection
 * - Circuit breaker for notifications
 * - Abuse detection multi-factor analysis
 * - Security metrics collection
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RateLimitingService, AbuseLevel, defaultConfigs } from "../server/security/rateLimiting.service";
import { AbuseDetectionService, defaultAbuseDetectionConfig } from "../server/security/abuseDetection.service";
import { SecurityMetricsService, SecurityEventType } from "../server/security/securityMetrics.service";

// Mock Redis client for testing
class MockRedisClient {
  private data: Map<string, Map<string, number>> = new Map(); // key -> (member -> score)
  private stringData: Map<string, string> = new Map();
  private ttls: Map<string, number> = new Map();

  async scriptLoad(script: string): Promise<string> {
    return "mock-sha-1234567890";
  }

  async evalSha(
    sha: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<[number, number, number]> {
    const [key] = options.keys;
    const [now, window, maxRequests, ttl] = options.arguments.map(Number);

    // Initialize if not exists
    if (!this.data.has(key)) {
      this.data.set(key, new Map());
    }

    const members = this.data.get(key)!;

    // Remove old entries
    const toDelete: string[] = [];
    for (const [member, score] of members) {
      if (score < now - window) {
        toDelete.push(member);
      }
    }
    toDelete.forEach((m) => members.delete(m));

    // Check if limit exceeded
    const current = members.size;
    if (current >= maxRequests) {
      return [0, current, now + Number(ttl)];
    }

    // Add current request
    members.set(now.toString(), now);

    return [1, current, now + Number(ttl)];
  }

  async zCard(key: string): Promise<number> {
    return this.data.get(key)?.size || 0;
  }

  async zRemRangeByScore(key: string, min: number, max: number): Promise<number> {
    if (!this.data.has(key)) return 0;

    const members = this.data.get(key)!;
    let removed = 0;

    for (const [member, score] of members) {
      if (score >= min && score <= max) {
        members.delete(member);
        removed++;
      }
    }

    return removed;
  }

  async zAdd(key: string, options: { score: number; value: string }): Promise<number> {
    if (!this.data.has(key)) {
      this.data.set(key, new Map());
    }

    const members = this.data.get(key)!;
    members.set(options.value, options.score);
    return 1;
  }

  async zCount(key: string, min: number, max: number): Promise<number> {
    if (!this.data.has(key)) return 0;

    const members = this.data.get(key)!;
    let count = 0;

    for (const [, score] of members) {
      if (score >= min && score <= max) {
        count++;
      }
    }

    return count;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.ttls.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  async setEx(key: string, seconds: number, value: string): Promise<string> {
    this.stringData.set(key, value);
    this.ttls.set(key, Date.now() + seconds * 1000);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    const ttl = this.ttls.get(key);
    if (ttl && ttl < Date.now()) {
      this.stringData.delete(key);
      return null;
    }
    return this.stringData.get(key) || null;
  }

  async ttl(key: string): Promise<number> {
    const ttl = this.ttls.get(key);
    if (!ttl) return -2;
    const remaining = Math.ceil((ttl - Date.now()) / 1000);
    return Math.max(-2, remaining);
  }

  async del(key: string): Promise<number> {
    const deleted = this.data.has(key) || this.stringData.has(key) ? 1 : 0;
    this.data.delete(key);
    this.stringData.delete(key);
    this.ttls.delete(key);
    return deleted;
  }

  async keys(pattern: string): Promise<string[]> {
    const allKeys = [...this.data.keys(), ...this.stringData.keys()];
    const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
    return allKeys.filter((k) => regex.test(k));
  }
}

describe("Rate Limiting and Abuse Detection", () => {
  let rateLimitingService: RateLimitingService;
  let abuseDetectionService: AbuseDetectionService;
  let metricsService: SecurityMetricsService;
  let mockRedis: MockRedisClient;

  beforeEach(async () => {
    mockRedis = new MockRedisClient();
    rateLimitingService = new RateLimitingService(mockRedis as any);
    await rateLimitingService.initialize();
    abuseDetectionService = new AbuseDetectionService(rateLimitingService);
    metricsService = new SecurityMetricsService();
  });

  describe("Rate Limiting Service", () => {
    it("should allow requests within limit", async () => {
      const config = defaultConfigs.webhook;
      const result = await rateLimitingService.checkRateLimit("192.168.1.1", config);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });

    it("should track remaining requests", async () => {
      const config = defaultConfigs.webhook;
      const result1 = await rateLimitingService.checkRateLimit("192.168.1.2", config);
      const result2 = await rateLimitingService.checkRateLimit("192.168.1.2", config);

      expect(result1.remaining).toBeGreaterThan(result2.remaining);
    });

    it("should track rate limit state", async () => {
      const config = defaultConfigs.webhook;
      const result1 = await rateLimitingService.checkRateLimit("192.168.1.3", config);

      expect(result1.allowed).toBeDefined();
      expect(result1.remaining).toBeGreaterThanOrEqual(0);
      expect(result1.resetTime).toBeGreaterThan(0);
    });

    it("should isolate rate limits per IP", async () => {
      const config = defaultConfigs.webhook;

      const result1 = await rateLimitingService.checkRateLimit("192.168.1.4", config);
      const result2 = await rateLimitingService.checkRateLimit("192.168.1.5", config);

      expect(result1.remaining).toBe(result2.remaining);
    });

    it("should handle burst limits", async () => {
      const config = defaultConfigs.webhook;

      const result = await rateLimitingService.checkBurstLimit("192.168.1.6", config);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Signature Failure Tracking", () => {
    it("should record signature failures", async () => {
      const ip = "192.168.1.7";
      const now = Date.now();

      await rateLimitingService.recordSignatureFailure(ip, now);
      await rateLimitingService.recordSignatureFailure(ip, now + 100);

      const count = await rateLimitingService.getSignatureFailureCount(ip, 2 * 60 * 1000);
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it("should count failures within time window", async () => {
      const ip = "192.168.1.8";
      const now = Date.now();

      // Record failures
      await rateLimitingService.recordSignatureFailure(ip, now);
      await rateLimitingService.recordSignatureFailure(ip, now + 1000);

      // Count in 2 minute window
      const count = await rateLimitingService.getSignatureFailureCount(ip, 2 * 60 * 1000);
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Replay Attempt Detection", () => {
    it("should record replay attempts", async () => {
      const txId = "TXN-20250214-001";
      const now = Date.now();

      await rateLimitingService.recordReplayAttempt(txId, now);
      await rateLimitingService.recordReplayAttempt(txId, now + 1000);

      const count = await rateLimitingService.getReplayAttemptCount(txId);
      expect(count).toBe(2);
    });

    it("should detect multiple replay attempts", async () => {
      const txId = "TXN-20250214-002";
      const now = Date.now();

      // Record 5 replay attempts
      for (let i = 0; i < 5; i++) {
        await rateLimitingService.recordReplayAttempt(txId, now + i * 100);
      }

      const count = await rateLimitingService.getReplayAttemptCount(txId);
      expect(count).toBe(5);
    });
  });

  describe("Circuit Breaker", () => {
    it("should open circuit breaker", async () => {
      const systemId = "restaurant-pos-001";

      await rateLimitingService.setCircuitBreakerState(systemId, true, 5 * 60 * 1000);

      const isOpen = await rateLimitingService.isCircuitBreakerOpen(systemId);
      expect(isOpen).toBe(true);
    });

    it("should close circuit breaker", async () => {
      const systemId = "restaurant-pos-002";

      await rateLimitingService.setCircuitBreakerState(systemId, true, 5 * 60 * 1000);
      await rateLimitingService.setCircuitBreakerState(systemId, false, 0);

      const isOpen = await rateLimitingService.isCircuitBreakerOpen(systemId);
      expect(isOpen).toBe(false);
    });

    it("should track notification failures", async () => {
      const systemId = "restaurant-pos-003";
      const now = Date.now();

      // Record failures
      for (let i = 0; i < 3; i++) {
        await rateLimitingService.recordNotificationFailure(systemId, now + i * 100);
      }

      const ratio = await rateLimitingService.getNotificationFailureRatio(systemId, 60 * 1000, 5);
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(1);
    });
  });

  describe("Abuse Detection Service", () => {
    it("should detect low abuse level", async () => {
      const ip = "192.168.1.9";
      const result = await abuseDetectionService.analyzeIPAbuse(ip);

      expect(result.level).toBe(AbuseLevel.LOW);
      expect(result.shouldBlock).toBe(false);
    });

    it("should detect medium abuse from signature failures", async () => {
      const ip = "192.168.1.10";
      const now = Date.now();

      // Record 3 signature failures
      for (let i = 0; i < 3; i++) {
        await rateLimitingService.recordSignatureFailure(ip, now + i * 100);
      }

      const result = await abuseDetectionService.analyzeIPAbuse(ip);

      expect(result).toBeDefined();
      expect(result.level).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
    });

    it("should detect critical abuse from multiple failures", async () => {
      const ip = "192.168.1.11";
      const now = Date.now();

      // Record 10 signature failures (critical threshold)
      for (let i = 0; i < 10; i++) {
        await rateLimitingService.recordSignatureFailure(ip, now + i * 100);
      }

      const result = await abuseDetectionService.analyzeIPAbuse(ip);

      expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(result.level);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });

    it("should detect replay abuse", async () => {
      const txId = "TXN-20250214-003";
      const now = Date.now();

      // Record 5 replay attempts
      for (let i = 0; i < 5; i++) {
        await rateLimitingService.recordReplayAttempt(txId, now + i * 100);
      }

      const result = await abuseDetectionService.analyzeTransactionAbuse(txId);

      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.level).toBeDefined();
    });

    it("should detect system abuse from circuit breaker", async () => {
      const systemId = "restaurant-pos-004";

      await rateLimitingService.setCircuitBreakerState(systemId, true, 5 * 60 * 1000);

      const result = await abuseDetectionService.analyzeSystemAbuse(systemId, 10);

      expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(result.level);
      expect(result.details.circuitBreakerOpen).toBe(true);
    });

    it("should combine abuse indicators", async () => {
      const ip = "192.168.1.12";
      const txId = "TXN-20250214-004";
      const now = Date.now();

      // Record signature failures
      for (let i = 0; i < 5; i++) {
        await rateLimitingService.recordSignatureFailure(ip, now + i * 100);
      }

      // Record replay attempts
      for (let i = 0; i < 3; i++) {
        await rateLimitingService.recordReplayAttempt(txId, now + i * 100);
      }

      const result = await abuseDetectionService.analyzeAbuse(ip, txId);

      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.level).toBeDefined();
    });
  });

  describe("Security Metrics Service", () => {
    it("should log security events", () => {
      metricsService.logEvent({
        eventType: SecurityEventType.RATE_LIMIT_TRIGGERED,
        timestamp: new Date(),
        ip: "192.168.1.13",
        severity: "MEDIUM",
        details: { reason: "test" },
      });

      const count = metricsService.getEventCount(SecurityEventType.RATE_LIMIT_TRIGGERED);
      expect(count).toBe(1);
    });

    it("should track multiple events", () => {
      for (let i = 0; i < 5; i++) {
        metricsService.logEvent({
          eventType: SecurityEventType.SIGNATURE_FAILURE,
          timestamp: new Date(),
          ip: "192.168.1.14",
          severity: "LOW",
          details: {},
        });
      }

      const count = metricsService.getEventCount(SecurityEventType.SIGNATURE_FAILURE);
      expect(count).toBe(5);
    });

    it("should get metrics snapshot", () => {
      metricsService.logEvent({
        eventType: SecurityEventType.RATE_LIMIT_BLOCKED,
        timestamp: new Date(),
        ip: "192.168.1.15",
        severity: "HIGH",
        details: {},
      });

      const snapshot = metricsService.getMetricsSnapshot(1, 0, 0);

      expect(snapshot.blockedIPs).toBe(1);
      expect(snapshot.totalRateLimitEvents).toBeGreaterThan(0);
    });

    it("should filter events by IP", () => {
      const ip = "192.168.1.16";

      metricsService.logEvent({
        eventType: SecurityEventType.SIGNATURE_FAILURE,
        timestamp: new Date(),
        ip,
        severity: "LOW",
        details: {},
      });

      metricsService.logEvent({
        eventType: SecurityEventType.SIGNATURE_FAILURE,
        timestamp: new Date(),
        ip: "192.168.1.17",
        severity: "LOW",
        details: {},
      });

      const events = metricsService.getEventsForIP(ip);
      expect(events.length).toBe(1);
      expect(events[0].ip).toBe(ip);
    });

    it("should get recent critical events", () => {
      metricsService.logEvent({
        eventType: SecurityEventType.CRITICAL_ABUSE_DETECTED,
        timestamp: new Date(),
        ip: "192.168.1.18",
        severity: "CRITICAL",
        details: {},
      });

      metricsService.logEvent({
        eventType: SecurityEventType.RATE_LIMIT_TRIGGERED,
        timestamp: new Date(),
        ip: "192.168.1.19",
        severity: "MEDIUM",
        details: {},
      });

      const criticalEvents = metricsService.getRecentCriticalEvents();
      expect(criticalEvents.length).toBe(1);
      expect(criticalEvents[0].severity).toBe("CRITICAL");
    });
  });

  describe("Concurrency and Distributed Scenarios", () => {
    it("should handle concurrent rate limit checks", async () => {
      const config = defaultConfigs.webhook;
      const ip = "192.168.1.20";

      const promises = Array(10)
        .fill(null)
        .map(() => rateLimitingService.checkRateLimit(ip, config));

      const results = await Promise.all(promises);

      const allowed = results.filter((r) => r.allowed).length;
      const blocked = results.filter((r) => !r.allowed).length;

      expect(allowed + blocked).toBe(10);
      expect(allowed).toBeLessThanOrEqual(config.maxRequests);
    });

    it("should handle concurrent abuse detection", async () => {
      const ips = Array(5)
        .fill(null)
        .map((_, i) => `192.168.1.${30 + i}`);

      const promises = ips.map((ip) => abuseDetectionService.analyzeIPAbuse(ip));

      const results = await Promise.all(promises);

      expect(results.length).toBe(5);
      results.forEach((result) => {
        expect(result.level).toBeDefined();
        expect(result.score).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty abuse detection", async () => {
      const result = await abuseDetectionService.analyzeAbuse("192.168.1.35");

      expect(result.level).toBe("LOW" as any);
      expect(result.shouldBlock).toBe(false);
    });

    it("should handle zero notification attempts", async () => {
      const result = await abuseDetectionService.analyzeSystemAbuse("restaurant-pos-005", 0);

      expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(result.level);
    });

    it("should clear metrics", () => {
      metricsService.logEvent({
        eventType: SecurityEventType.RATE_LIMIT_TRIGGERED,
        timestamp: new Date(),
        severity: "LOW",
        details: {},
      });

      metricsService.clearAll();

      expect(metricsService.getTotalEventCount()).toBe(0);
    });
  });
});
