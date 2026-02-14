/**
 * LEGAL COMPLIANCE NOTICE
 *
 * This module implements rate limiting and abuse detection for the Internal Payment Orchestrator.
 * This service does NOT handle, store, or move money.
 * Rate limiting is security-only, protecting against brute-force and replay attacks.
 */

import redis from "redis";

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  burstWindow?: number; // Burst window in milliseconds (optional)
  burstMaxRequests?: number; // Max requests in burst window (optional)
  blockDurationMs?: number; // Duration to block after threshold breach
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number; // Unix timestamp in seconds
  retryAfter?: number; // Seconds until retry allowed
  blocked?: boolean; // Whether IP is currently blocked
}

/**
 * Abuse detection levels
 */
export enum AbuseLevel {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL",
}

/**
 * Abuse detection result
 */
export interface AbuseDetectionResult {
  level: AbuseLevel;
  score: number; // 0-100
  factors: string[]; // List of detected abuse factors
  shouldBlock: boolean;
  reason?: string;
}

/**
 * Default rate limit configurations
 */
export const defaultConfigs = {
  webhook: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60,
    burstWindow: 5 * 1000, // 5 seconds
    burstMaxRequests: 70, // 60 + 10 burst tolerance
    blockDurationMs: 15 * 60 * 1000, // 15 minutes
  },
  outboundNotification: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    blockDurationMs: 5 * 60 * 1000, // 5 minutes
  },
  hourlyNotification: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 1000,
    blockDurationMs: 5 * 60 * 1000, // 5 minutes
  },
};

/**
 * Redis-based rate limiting service
 */
export class RateLimitingService {
  private redisClient: redis.RedisClientType;
  private scriptSHA: string = "";

  constructor(redisClient: redis.RedisClientType) {
    this.redisClient = redisClient;
  }

  /**
   * Initialize the service (load Lua scripts)
   */
  async initialize(): Promise<void> {
    try {
      // Lua script for atomic rate limit check
      const luaScript = `
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local window = tonumber(ARGV[2])
        local maxRequests = tonumber(ARGV[3])
        local ttl = tonumber(ARGV[4])
        
        --      -- Remove old entries outside window
      redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
      
      -- Count current requests
      local current = redis.call('ZCARD', key)
        
        -- Check if limit exceeded
        if current >= maxRequests then
          return {0, current, now + ttl}
        end
        
        -- Add current request
        redis.call('ZADD', key, now, now)
        redis.call('EXPIRE', key, math.ceil(ttl / 1000))
        
        return {1, current, now + ttl}
      `;

      // Load script and store SHA
      this.scriptSHA = await this.redisClient.scriptLoad(luaScript);
    } catch (error) {
      console.error("[RateLimit] Failed to initialize:", error);
      throw error;
    }
  }

  /**
   * Check rate limit for a key (IP, system ID, etc.)
   *
   * @param key Unique identifier (IP address, system ID, etc.)
   * @param config Rate limit configuration
   * @returns Rate limit result
   */
  async checkRateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    try {
      const now = Date.now();
      const redisKey = `ratelimit:${key}`;

      // Execute Lua script atomically
      const result = (await this.redisClient.evalSha(this.scriptSHA, {
        keys: [redisKey],
        arguments: [
          now.toString(),
          config.windowMs.toString(),
          config.maxRequests.toString(),
          config.blockDurationMs?.toString() || "0",
        ],
      })) as [number, number, number];

      const [allowed, current, resetTime] = result;
      const remaining = Math.max(0, config.maxRequests - current - 1);

      return {
        allowed: allowed === 1,
        remaining,
        resetTime: Math.ceil(resetTime / 1000),
        retryAfter: allowed === 1 ? undefined : Math.ceil((resetTime - now) / 1000),
      };
    } catch (error) {
      console.error("[RateLimit] Error checking rate limit:", error);
      // Fail open on Redis error (allow request)
      return {
        allowed: true,
        remaining: -1,
        resetTime: Math.ceil((Date.now() + 60000) / 1000),
      };
    }
  }

  /**
   * Check burst rate limit
   *
   * @param key Unique identifier
   * @param config Rate limit configuration with burst settings
   * @returns Rate limit result
   */
  async checkBurstLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    if (!config.burstWindow || !config.burstMaxRequests) {
      return this.checkRateLimit(key, config);
    }

    try {
      const now = Date.now();
      const burstKey = `ratelimit:burst:${key}`;

      // Check burst window
      const burstResult = await this.redisClient.zCard(burstKey);

      // Remove old entries
      await this.redisClient.zRemRangeByScore(burstKey, 0, now - config.burstWindow);

      const current = await this.redisClient.zCard(burstKey);

      if (current >= config.burstMaxRequests) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: Math.ceil((now + config.blockDurationMs!) / 1000),
          retryAfter: Math.ceil(config.blockDurationMs! / 1000),
        };
      }

      // Add current request
      await this.redisClient.zAdd(burstKey, { score: now, value: now.toString() });
      await this.redisClient.expire(burstKey, Math.ceil(config.burstWindow / 1000));

      return {
        allowed: true,
        remaining: config.burstMaxRequests - current - 1,
        resetTime: Math.ceil((now + config.burstWindow) / 1000),
      };
    } catch (error) {
      console.error("[RateLimit] Error checking burst limit:", error);
      return {
        allowed: true,
        remaining: -1,
        resetTime: Math.ceil((Date.now() + 60000) / 1000),
      };
    }
  }

  /**
   * Block a key temporarily
   *
   * @param key Unique identifier
   * @param durationMs Duration to block in milliseconds
   */
  async blockKey(key: string, durationMs: number): Promise<void> {
    try {
      const blockKey = `ratelimit:blocked:${key}`;
      await this.redisClient.setEx(blockKey, Math.ceil(durationMs / 1000), "1");
    } catch (error) {
      console.error("[RateLimit] Error blocking key:", error);
    }
  }

  /**
   * Check if key is blocked
   *
   * @param key Unique identifier
   * @returns Whether key is blocked
   */
  async isKeyBlocked(key: string): Promise<boolean> {
    try {
      const blockKey = `ratelimit:blocked:${key}`;
      const blocked = await this.redisClient.get(blockKey);
      return blocked !== null;
    } catch (error) {
      console.error("[RateLimit] Error checking block status:", error);
      return false;
    }
  }

  /**
   * Get time until key is unblocked
   *
   * @param key Unique identifier
   * @returns Seconds until unblocked, or 0 if not blocked
   */
  async getBlockRemainingTime(key: string): Promise<number> {
    try {
      const blockKey = `ratelimit:blocked:${key}`;
      const ttl = await this.redisClient.ttl(blockKey);
      return Math.max(0, ttl);
    } catch (error) {
      console.error("[RateLimit] Error getting block time:", error);
      return 0;
    }
  }

  /**
   * Record a signature failure for abuse detection
   *
   * @param ip IP address
   * @param timestamp Timestamp of failure
   */
  async recordSignatureFailure(ip: string, timestamp: number): Promise<void> {
    try {
      const key = `security:sig_failures:${ip}`;
      await this.redisClient.zAdd(key, { score: timestamp, value: timestamp.toString() });
      await this.redisClient.expire(key, 2 * 60); // 2 minute TTL
    } catch (error) {
      console.error("[RateLimit] Error recording signature failure:", error);
    }
  }

  /**
   * Get signature failure count in time window
   *
   * @param ip IP address
   * @param windowMs Time window in milliseconds
   * @returns Number of failures in window
   */
  async getSignatureFailureCount(ip: string, windowMs: number): Promise<number> {
    try {
      const key = `security:sig_failures:${ip}`;
      const now = Date.now();
      const count = await this.redisClient.zCount(key, now - windowMs, now);
      return count;
    } catch (error) {
      console.error("[RateLimit] Error getting signature failure count:", error);
      return 0;
    }
  }

  /**
   * Record a replay attempt
   *
   * @param transactionId Transaction ID
   * @param timestamp Timestamp of attempt
   */
  async recordReplayAttempt(transactionId: string, timestamp: number): Promise<void> {
    try {
      const key = `security:replay:${transactionId}`;
      await this.redisClient.zAdd(key, { score: timestamp, value: timestamp.toString() });
      await this.redisClient.expire(key, 24 * 60 * 60); // 24 hour TTL
    } catch (error) {
      console.error("[RateLimit] Error recording replay attempt:", error);
    }
  }

  /**
   * Get replay attempt count
   *
   * @param transactionId Transaction ID
   * @returns Number of replay attempts
   */
  async getReplayAttemptCount(transactionId: string): Promise<number> {
    try {
      const key = `security:replay:${transactionId}`;
      const count = await this.redisClient.zCard(key);
      return count;
    } catch (error) {
      console.error("[RateLimit] Error getting replay attempt count:", error);
      return 0;
    }
  }

  /**
   * Record notification failure for circuit breaker
   *
   * @param systemId External system ID
   * @param timestamp Timestamp of failure
   */
  async recordNotificationFailure(systemId: string, timestamp: number): Promise<void> {
    try {
      const key = `circuit:failures:${systemId}`;
      await this.redisClient.zAdd(key, { score: timestamp, value: timestamp.toString() });
      await this.redisClient.expire(key, 5 * 60); // 5 minute TTL
    } catch (error) {
      console.error("[RateLimit] Error recording notification failure:", error);
    }
  }

  /**
   * Get notification failure ratio in time window
   *
   * @param systemId External system ID
   * @param windowMs Time window in milliseconds
   * @param totalAttempts Total notification attempts in window
   * @returns Failure ratio (0-1)
   */
  async getNotificationFailureRatio(
    systemId: string,
    windowMs: number,
    totalAttempts: number
  ): Promise<number> {
    try {
      const key = `circuit:failures:${systemId}`;
      const now = Date.now();
      const failures = await this.redisClient.zCount(key, now - windowMs, now);

      if (totalAttempts === 0) return 0;
      return failures / totalAttempts;
    } catch (error) {
      console.error("[RateLimit] Error getting failure ratio:", error);
      return 0;
    }
  }

  /**
   * Set circuit breaker state
   *
   * @param systemId External system ID
   * @param open Whether circuit is open
   * @param durationMs Duration to keep open
   */
  async setCircuitBreakerState(
    systemId: string,
    open: boolean,
    durationMs: number
  ): Promise<void> {
    try {
      const key = `circuit:open:${systemId}`;
      if (open) {
        await this.redisClient.setEx(key, Math.ceil(durationMs / 1000), "1");
      } else {
        await this.redisClient.del(key);
      }
    } catch (error) {
      console.error("[RateLimit] Error setting circuit breaker:", error);
    }
  }

  /**
   * Check if circuit breaker is open
   *
   * @param systemId External system ID
   * @returns Whether circuit is open
   */
  async isCircuitBreakerOpen(systemId: string): Promise<boolean> {
    try {
      const key = `circuit:open:${systemId}`;
      const state = await this.redisClient.get(key);
      return state !== null;
    } catch (error) {
      console.error("[RateLimit] Error checking circuit breaker:", error);
      return false;
    }
  }

  /**
   * Clear all rate limit data for a key
   *
   * @param key Unique identifier
   */
  async clearRateLimit(key: string): Promise<void> {
    try {
      const patterns = [
        `ratelimit:${key}`,
        `ratelimit:burst:${key}`,
        `ratelimit:blocked:${key}`,
      ];

      for (const pattern of patterns) {
        await this.redisClient.del(pattern);
      }
    } catch (error) {
      console.error("[RateLimit] Error clearing rate limit:", error);
    }
  }

  /**
   * Get rate limit statistics for monitoring
   *
   * @returns Statistics object
   */
  async getStatistics(): Promise<Record<string, unknown>> {
    try {
      // Get all keys matching patterns
      const blockedKeys = await this.redisClient.keys("ratelimit:blocked:*");
      const circuitBreakerKeys = await this.redisClient.keys("circuit:open:*");
      const signatureFailureKeys = await this.redisClient.keys("security:sig_failures:*");

      return {
        blockedIPs: blockedKeys.length,
        openCircuitBreakers: circuitBreakerKeys.length,
        activeSignatureFailures: signatureFailureKeys.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("[RateLimit] Error getting statistics:", error);
      return {
        error: "Failed to get statistics",
        timestamp: new Date().toISOString(),
      };
    }
  }
}

/**
 * Create and initialize rate limiting service
 *
 * @param redisClient Redis client instance
 * @returns Initialized RateLimitingService
 */
export async function createRateLimitingService(
  redisClient: redis.RedisClientType
): Promise<RateLimitingService> {
  const service = new RateLimitingService(redisClient);
  await service.initialize();
  return service;
}
