/**
 * Compliance Mode Service
 * 
 * Implements regulatory compliance features:
 * - Automatic audit trail integrity verification
 * - Tamper detection and breach alerts
 * - Fail-safe webhook locking on security breach
 * - Compliance status tracking
 * 
 * When COMPLIANCE_MODE=true:
 * - Audit integrity verified every 5 minutes
 * - Any chain break triggers CRITICAL alert
 * - Webhook endpoint locked until manual intervention
 * - Security breach logged for forensic investigation
 */

import { AuditTrailService, AuditEventType } from "./auditTrail.service";

export enum ComplianceStatus {
  HEALTHY = "HEALTHY",
  DEGRADED = "DEGRADED",
  BREACH_DETECTED = "BREACH_DETECTED",
  LOCKED = "LOCKED",
}

export interface ComplianceState {
  status: ComplianceStatus;
  lastIntegrityCheck: number;
  integrityValid: boolean;
  breachDetectedAt?: number;
  breachReason?: string;
  webhookLocked: boolean;
  lockedAt?: number;
}

/**
 * Compliance mode service
 * Manages regulatory compliance and security breach detection
 */
export class ComplianceModeService {
  private auditTrailService: AuditTrailService;
  private complianceEnabled: boolean;
  private integrityCheckInterval: any = null;
  private complianceState: ComplianceState = {
    status: ComplianceStatus.HEALTHY,
    lastIntegrityCheck: 0,
    integrityValid: true,
    webhookLocked: false,
  };

  constructor(auditTrailService: AuditTrailService, enableCompliance: boolean = false) {
    this.auditTrailService = auditTrailService;
    this.complianceEnabled = enableCompliance;

    if (this.complianceEnabled) {
      this.startIntegrityVerification();
    }
  }

  /**
   * Start periodic integrity verification (every 5 minutes)
   */
  private startIntegrityVerification(): void {
    // Run first check immediately
    this.performIntegrityCheck();

    // Then run every 5 minutes
    this.integrityCheckInterval = setInterval(() => {
      this.performIntegrityCheck();
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Perform audit trail integrity verification
   */
  private async performIntegrityCheck(): Promise<void> {
    try {
      const result = await this.auditTrailService.verifyIntegrity();

      this.complianceState.lastIntegrityCheck = Date.now();

      if (!result.isValid) {
        // Chain broken - security breach detected
        await this.handleSecurityBreach(
          `Audit trail integrity check failed at event ${result.brokenAtEventId}`
        );
      } else {
        // Chain valid - update status
        this.complianceState.integrityValid = true;
        if (this.complianceState.status === ComplianceStatus.DEGRADED) {
          this.complianceState.status = ComplianceStatus.HEALTHY;
        }
      }
    } catch (error) {
      console.error("[ComplianceMode] Error performing integrity check:", error);
      this.complianceState.status = ComplianceStatus.DEGRADED;
    }
  }

  /**
   * Handle security breach
   * - Log security event
   * - Lock webhook endpoint
   * - Update compliance status
   */
  private async handleSecurityBreach(reason: string): Promise<void> {
    console.error("[ComplianceMode] SECURITY BREACH DETECTED:", reason);

    // Update compliance state
    this.complianceState.status = ComplianceStatus.BREACH_DETECTED;
    this.complianceState.integrityValid = false;
    this.complianceState.breachDetectedAt = Date.now();
    this.complianceState.breachReason = reason;

    // Lock webhook endpoint
    this.lockWebhookEndpoint();

    // Log security breach event
    try {
      await this.auditTrailService.logEvent(
        AuditEventType.SECURITY_BREACH_DETECTED,
        "COMPLIANCE_CHECK",
        {
          reason,
          timestamp: Date.now(),
        }
      );
    } catch (error) {
      console.error("[ComplianceMode] Error logging security breach:", error);
    }

    // Trigger internal alert (would integrate with monitoring system)
    this.triggerSecurityAlert(reason);
  }

  /**
   * Lock webhook endpoint
   * All webhook requests will be rejected until manually unlocked
   */
  private lockWebhookEndpoint(): void {
    this.complianceState.webhookLocked = true;
    this.complianceState.lockedAt = Date.now();
    console.error("[ComplianceMode] Webhook endpoint LOCKED due to security breach");
  }

  /**
   * Unlock webhook endpoint (manual intervention required)
   */
  async unlockWebhookEndpoint(): Promise<void> {
    this.complianceState.webhookLocked = false;
    console.log("[ComplianceMode] Webhook endpoint unlocked by administrator");

    // Log unlock event
    try {
      await this.auditTrailService.logEvent(
        AuditEventType.COMPLIANCE_CHECK_PASSED,
        "COMPLIANCE_UNLOCK",
        {
          action: "webhook_endpoint_unlocked",
          timestamp: Date.now(),
        }
      );
    } catch (error) {
      console.error("[ComplianceMode] Error logging unlock event:", error);
    }
  }

  /**
   * Check if webhook endpoint is locked
   */
  isWebhookLocked(): boolean {
    return this.complianceState.webhookLocked;
  }

  /**
   * Trigger security alert
   * Integration point for monitoring/alerting systems
   */
  private triggerSecurityAlert(reason: string): void {
    // This would integrate with:
    // - PagerDuty
    // - Slack
    // - Email alerts
    // - Security dashboard
    console.error("[ComplianceMode] ALERT: Security breach detected -", reason);
  }

  /**
   * Get current compliance status
   */
  getComplianceStatus(): ComplianceState {
    return { ...this.complianceState };
  }

  /**
   * Get compliance metrics for reporting
   */
  async getComplianceMetrics(): Promise<any> {
    const eventCount = await this.auditTrailService.getEventCount();
    const integrityResult = await this.auditTrailService.verifyIntegrity();

    return {
      complianceEnabled: this.complianceEnabled,
      status: this.complianceState.status,
      totalAuditEvents: eventCount,
      lastIntegrityCheck: new Date(this.complianceState.lastIntegrityCheck).toISOString(),
      integrityValid: integrityResult.isValid,
      lastEventHash: integrityResult.lastEventHash,
      webhookLocked: this.complianceState.webhookLocked,
      breachDetectedAt: this.complianceState.breachDetectedAt
        ? new Date(this.complianceState.breachDetectedAt).toISOString()
        : null,
      breachReason: this.complianceState.breachReason,
    };
  }

  /**
   * Verify webhook can be processed
   * Returns false if endpoint is locked due to security breach
   */
  canProcessWebhook(): boolean {
    if (!this.complianceEnabled) return true; // No restrictions if compliance mode disabled

    if (this.complianceState.webhookLocked) {
      console.warn("[ComplianceMode] Webhook rejected - endpoint locked due to security breach");
      return false;
    }

    return true;
  }

  /**
   * Stop compliance verification (for testing/shutdown)
   */
  stop(): void {
    if (this.integrityCheckInterval) {
      clearInterval(this.integrityCheckInterval);
      this.integrityCheckInterval = null;
    }
  }
}
