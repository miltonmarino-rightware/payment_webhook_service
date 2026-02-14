/**
 * LEGAL COMPLIANCE NOTICE
 *
 * This module implements abuse detection for the Internal Payment Orchestrator.
 * This service does NOT handle, store, or move money.
 * Abuse detection is security-only, protecting against attacks and misuse.
 */

import { RateLimitingService, AbuseLevel } from "./rateLimiting.service";

/**
 * Abuse detection configuration
 */
export interface AbuseDetectionConfig {
  signatureFailureThreshold: number; // 3 failures in 2 minutes = MEDIUM
  signatureFailureCriticalThreshold: number; // 10 failures in 2 minutes = CRITICAL
  replayAttemptThreshold: number; // 5 replay attempts = MEDIUM
  replayAttemptCriticalThreshold: number; // 20 replay attempts = CRITICAL
  notificationFailureRatioThreshold: number; // 50% failures = MEDIUM
  notificationFailureRatioCriticalThreshold: number; // 80% failures = CRITICAL
  signatureFailureWindow: number; // 2 minutes
  replayAttemptWindow: number; // 1 hour
  notificationFailureWindow: number; // 5 minutes
}

/**
 * Default abuse detection configuration
 */
export const defaultAbuseDetectionConfig: AbuseDetectionConfig = {
  signatureFailureThreshold: 3,
  signatureFailureCriticalThreshold: 10,
  replayAttemptThreshold: 5,
  replayAttemptCriticalThreshold: 20,
  notificationFailureRatioThreshold: 0.5, // 50%
  notificationFailureRatioCriticalThreshold: 0.8, // 80%
  signatureFailureWindow: 2 * 60 * 1000, // 2 minutes
  replayAttemptWindow: 60 * 60 * 1000, // 1 hour
  notificationFailureWindow: 5 * 60 * 1000, // 5 minutes
};

/**
 * Abuse detection result
 */
export interface AbuseDetectionResult {
  level: AbuseLevel;
  score: number; // 0-100
  factors: string[]; // List of detected abuse factors
  shouldBlock: boolean;
  reason?: string;
  details: {
    signatureFailures?: number;
    replayAttempts?: number;
    notificationFailureRatio?: number;
    circuitBreakerOpen?: boolean;
  };
}

/**
 * Abuse detection service
 */
export class AbuseDetectionService {
  private rateLimitingService: RateLimitingService;
  private config: AbuseDetectionConfig;

  constructor(rateLimitingService: RateLimitingService, config?: AbuseDetectionConfig) {
    this.rateLimitingService = rateLimitingService;
    this.config = config || defaultAbuseDetectionConfig;
  }

  /**
   * Analyze abuse level for an IP address
   *
   * @param ip IP address to analyze
   * @returns Abuse detection result
   */
  async analyzeIPAbuse(ip: string): Promise<AbuseDetectionResult> {
    const factors: string[] = [];
    let score = 0;

    // Check signature failures
    const signatureFailures = await this.rateLimitingService.getSignatureFailureCount(
      ip,
      this.config.signatureFailureWindow
    );

    if (signatureFailures >= this.config.signatureFailureCriticalThreshold) {
      factors.push(`${signatureFailures} signature failures in ${this.config.signatureFailureWindow / 1000}s`);
      score += 40;
    } else if (signatureFailures >= this.config.signatureFailureThreshold) {
      factors.push(`${signatureFailures} signature failures in ${this.config.signatureFailureWindow / 1000}s`);
      score += 20;
    }

    // Determine abuse level
    let level = AbuseLevel.LOW;
    if (score >= 80) {
      level = AbuseLevel.CRITICAL;
    } else if (score >= 60) {
      level = AbuseLevel.HIGH;
    } else if (score >= 30) {
      level = AbuseLevel.MEDIUM;
    }

    return {
      level,
      score,
      factors,
      shouldBlock: level === AbuseLevel.CRITICAL,
      reason: factors.length > 0 ? factors.join("; ") : undefined,
      details: {
        signatureFailures,
      },
    };
  }

  /**
   * Analyze abuse level for a transaction
   *
   * @param transactionId Transaction ID
   * @returns Abuse detection result
   */
  async analyzeTransactionAbuse(transactionId: string): Promise<AbuseDetectionResult> {
    const factors: string[] = [];
    let score = 0;

    // Check replay attempts
    const replayAttempts = await this.rateLimitingService.getReplayAttemptCount(transactionId);

    if (replayAttempts >= this.config.replayAttemptCriticalThreshold) {
      factors.push(`${replayAttempts} replay attempts detected`);
      score += 40;
    } else if (replayAttempts >= this.config.replayAttemptThreshold) {
      factors.push(`${replayAttempts} replay attempts detected`);
      score += 20;
    }

    // Determine abuse level
    let level = AbuseLevel.LOW;
    if (score >= 80) {
      level = AbuseLevel.CRITICAL;
    } else if (score >= 60) {
      level = AbuseLevel.HIGH;
    } else if (score >= 30) {
      level = AbuseLevel.MEDIUM;
    }

    return {
      level,
      score,
      factors,
      shouldBlock: level === AbuseLevel.CRITICAL,
      reason: factors.length > 0 ? factors.join("; ") : undefined,
      details: {
        replayAttempts,
      },
    };
  }

  /**
   * Analyze abuse level for an external system
   *
   * @param systemId External system ID
   * @param totalAttempts Total notification attempts in window
   * @returns Abuse detection result
   */
  async analyzeSystemAbuse(systemId: string, totalAttempts: number): Promise<AbuseDetectionResult> {
    const factors: string[] = [];
    let score = 0;

    // Check circuit breaker status
    const circuitBreakerOpen = await this.rateLimitingService.isCircuitBreakerOpen(systemId);
    if (circuitBreakerOpen) {
      factors.push("Circuit breaker is open");
      score += 30;
    }

    // Check notification failure ratio
    const failureRatio = await this.rateLimitingService.getNotificationFailureRatio(
      systemId,
      this.config.notificationFailureWindow,
      totalAttempts
    );

    if (failureRatio >= this.config.notificationFailureRatioCriticalThreshold) {
      factors.push(`${(failureRatio * 100).toFixed(1)}% notification failures`);
      score += 40;
    } else if (failureRatio >= this.config.notificationFailureRatioThreshold) {
      factors.push(`${(failureRatio * 100).toFixed(1)}% notification failures`);
      score += 20;
    }

    // Determine abuse level
    let level = AbuseLevel.LOW;
    if (score >= 80) {
      level = AbuseLevel.CRITICAL;
    } else if (score >= 60) {
      level = AbuseLevel.HIGH;
    } else if (score >= 30) {
      level = AbuseLevel.MEDIUM;
    }

    return {
      level,
      score,
      factors,
      shouldBlock: level === AbuseLevel.CRITICAL,
      reason: factors.length > 0 ? factors.join("; ") : undefined,
      details: {
        notificationFailureRatio: failureRatio,
        circuitBreakerOpen,
      },
    };
  }

  /**
   * Analyze combined abuse indicators
   *
   * @param ip IP address
   * @param transactionId Transaction ID (optional)
   * @param systemId External system ID (optional)
   * @param totalAttempts Total attempts (for system analysis)
   * @returns Combined abuse detection result
   */
  async analyzeAbuse(
    ip: string,
    transactionId?: string,
    systemId?: string,
    totalAttempts: number = 0
  ): Promise<AbuseDetectionResult> {
    const results: AbuseDetectionResult[] = [];

    // Analyze IP abuse
    const ipAbuse = await this.analyzeIPAbuse(ip);
    results.push(ipAbuse);

    // Analyze transaction abuse if provided
    if (transactionId) {
      const txAbuse = await this.analyzeTransactionAbuse(transactionId);
      results.push(txAbuse);
    }

    // Analyze system abuse if provided
    if (systemId) {
      const sysAbuse = await this.analyzeSystemAbuse(systemId, totalAttempts);
      results.push(sysAbuse);
    }

    // Combine results
    const combinedFactors = results.flatMap((r) => r.factors);
    const combinedScore = Math.min(100, results.reduce((sum, r) => sum + r.score, 0));
    const shouldBlock = results.some((r) => r.shouldBlock);

    // Determine combined level
    let combinedLevel = AbuseLevel.LOW;
    if (combinedScore >= 80) {
      combinedLevel = AbuseLevel.CRITICAL;
    } else if (combinedScore >= 60) {
      combinedLevel = AbuseLevel.HIGH;
    } else if (combinedScore >= 30) {
      combinedLevel = AbuseLevel.MEDIUM;
    }

    return {
      level: combinedLevel,
      score: combinedScore,
      factors: combinedFactors,
      shouldBlock,
      reason: combinedFactors.length > 0 ? combinedFactors.join("; ") : undefined,
      details: {
        signatureFailures: ipAbuse.details.signatureFailures,
        replayAttempts: transactionId ? results[1]?.details.replayAttempts : undefined,
        notificationFailureRatio: systemId ? results[results.length - 1]?.details.notificationFailureRatio : undefined,
        circuitBreakerOpen: systemId ? results[results.length - 1]?.details.circuitBreakerOpen : undefined,
      },
    };
  }

  /**
   * Get abuse level description
   *
   * @param level Abuse level
   * @returns Human-readable description
   */
  static getLevelDescription(level: AbuseLevel): string {
    switch (level) {
      case AbuseLevel.LOW:
        return "No significant abuse detected";
      case AbuseLevel.MEDIUM:
        return "Moderate abuse indicators detected - monitor closely";
      case AbuseLevel.HIGH:
        return "High abuse indicators detected - consider blocking";
      case AbuseLevel.CRITICAL:
        return "Critical abuse detected - immediate action required";
      default:
        return "Unknown abuse level";
    }
  }

  /**
   * Get recommended action for abuse level
   *
   * @param level Abuse level
   * @returns Recommended action
   */
  static getRecommendedAction(level: AbuseLevel): string {
    switch (level) {
      case AbuseLevel.LOW:
        return "ALLOW";
      case AbuseLevel.MEDIUM:
        return "MONITOR";
      case AbuseLevel.HIGH:
        return "RATE_LIMIT";
      case AbuseLevel.CRITICAL:
        return "BLOCK";
      default:
        return "UNKNOWN";
    }
  }
}

/**
 * Create abuse detection service
 *
 * @param rateLimitingService Rate limiting service instance
 * @param config Optional configuration
 * @returns AbuseDetectionService instance
 */
export function createAbuseDetectionService(
  rateLimitingService: RateLimitingService,
  config?: AbuseDetectionConfig
): AbuseDetectionService {
  return new AbuseDetectionService(rateLimitingService, config);
}
