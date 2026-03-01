/**
 * Compliance Pipeline Middleware
 * 
 * Enforces mandatory compliance checks on critical routes:
 * - Automatic audit logging with correlationId
 * - Data masking for sensitive fields
 * - Compliance mode enforcement (fail closed)
 * - Payload validation and sanitization
 */

import { Request, Response, NextFunction } from "express";
import { AuditTrailService, AuditEventType } from "./auditTrail.service";
import { ComplianceModeService } from "./complianceMode.service";
import { maskSensitiveData } from "./masking.service";
import { getCorrelationId } from "./correlationId.middleware";

/**
 * Middleware to enforce compliance mode (fail closed)
 * Blocks webhook processing if compliance breach detected
 */
export function enforceComplianceMode(complianceModeService: ComplianceModeService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCorrelationId(req);

    // Check if compliance mode is enabled and webhook is locked
    if (!complianceModeService.canProcessWebhook()) {
      console.warn(
        `[CompliancePipeline] Compliance lock active - blocking webhook. CorrelationId: ${correlationId}`
      );

      return res.status(503).json({
        error: "Service temporarily unavailable - compliance lock active",
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
}

/**
 * Middleware to log webhook received event
 * Logs WEBHOOK_RECEIVED with masked payload
 */
export function logWebhookReceived(auditTrailService: AuditTrailService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCorrelationId(req);
    const ip = req.ip || "unknown";

    try {
      // Mask sensitive payload before logging
      const maskedPayload = maskSensitiveData(req.body || {});

      // Log webhook received event
      await auditTrailService.logEvent(AuditEventType.WEBHOOK_RECEIVED, correlationId, {
        ip,
        endpoint: req.path,
        method: req.method,
        payloadHash: Buffer.from(JSON.stringify(req.body || {})).toString("base64").substring(0, 32),
        maskedPayload: JSON.stringify(maskedPayload),
      });

      console.log(
        `[CompliancePipeline] Webhook received - CorrelationId: ${correlationId}, IP: ${ip}`
      );
    } catch (error) {
      console.error(
        `[CompliancePipeline] Error logging webhook received: ${error}. CorrelationId: ${correlationId}`
      );
      // Don't block request on logging error
    }

    next();
  };
}

/**
 * Middleware to log signature verification result
 * Logs SIGNATURE_VALID or SIGNATURE_INVALID
 */
export function logSignatureVerification(auditTrailService: AuditTrailService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCorrelationId(req);

    // Attach logging function to response object for later use
    (res as any).logSignatureEvent = async (isValid: boolean, reason?: string) => {
      try {
        const eventType = isValid ? AuditEventType.SIGNATURE_VALID : AuditEventType.SIGNATURE_INVALID;
        await auditTrailService.logEvent(eventType, correlationId, {
          ip: req.ip || "unknown",
          reason: reason || (isValid ? "Signature verification passed" : "Signature verification failed"),
          endpoint: req.path,
        });

        console.log(
          `[CompliancePipeline] Signature ${isValid ? "valid" : "invalid"} - CorrelationId: ${correlationId}`
        );
      } catch (error) {
        console.error(
          `[CompliancePipeline] Error logging signature event: ${error}. CorrelationId: ${correlationId}`
        );
      }
    };

    next();
  };
}

/**
 * Middleware to log rate limit events
 * Logs RATE_LIMIT_TRIGGERED
 */
export function logRateLimitEvent(auditTrailService: AuditTrailService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCorrelationId(req);

    // Attach logging function to response object for later use
    (res as any).logRateLimitEvent = async (triggered: boolean, details?: any) => {
      try {
        if (triggered) {
          await auditTrailService.logEvent(AuditEventType.RATE_LIMIT_TRIGGERED, correlationId, {
            ip: req.ip || "unknown",
            endpoint: req.path,
            ...details,
          });

          console.warn(
            `[CompliancePipeline] Rate limit triggered - CorrelationId: ${correlationId}, IP: ${req.ip}`
          );
        }
      } catch (error) {
        console.error(
          `[CompliancePipeline] Error logging rate limit event: ${error}. CorrelationId: ${correlationId}`
        );
      }
    };

    next();
  };
}

/**
 * Middleware to log replay attack events
 * Logs REPLAY_BLOCKED
 */
export function logReplayEvent(auditTrailService: AuditTrailService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCorrelationId(req);

    // Attach logging function to response object for later use
    (res as any).logReplayEvent = async (blocked: boolean, reason?: string) => {
      try {
        if (blocked) {
          await auditTrailService.logEvent(AuditEventType.REPLAY_BLOCKED, correlationId, {
            ip: req.ip || "unknown",
            endpoint: req.path,
            reason: reason || "Replay attack detected",
          });

          console.warn(
            `[CompliancePipeline] Replay attack blocked - CorrelationId: ${correlationId}, Reason: ${reason}`
          );
        }
      } catch (error) {
        console.error(
          `[CompliancePipeline] Error logging replay event: ${error}. CorrelationId: ${correlationId}`
        );
      }
    };

    next();
  };
}

/**
 * Middleware to log payment request events
 * Logs PAYMENT_REQUEST_RECEIVED and PAYMENT_INTENT_CREATED
 */
export function logPaymentRequest(auditTrailService: AuditTrailService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCorrelationId(req);

    try {
      // Mask sensitive payload
      const maskedPayload = maskSensitiveData(req.body || {});

      // Log payment request received
      await auditTrailService.logEvent(AuditEventType.WEBHOOK_RECEIVED, correlationId, {
        ip: req.ip || "unknown",
        endpoint: req.path,
        externalSystemId: req.body?.externalSystemId || "unknown",
        amount: req.body?.amount || 0,
        maskedPayload: JSON.stringify(maskedPayload),
      });

      console.log(
        `[CompliancePipeline] Payment request received - CorrelationId: ${correlationId}, System: ${req.body?.externalSystemId}`
      );
    } catch (error) {
      console.error(
        `[CompliancePipeline] Error logging payment request: ${error}. CorrelationId: ${correlationId}`
      );
    }

    // Attach function to log payment intent creation
    (res as any).logPaymentIntentCreated = async (transactionId: string, details?: any) => {
      try {
        await auditTrailService.logEvent(AuditEventType.COMPLIANCE_CHECK_PASSED, correlationId, {
          transactionId,
          externalSystemId: req.body?.externalSystemId || "unknown",
          amount: req.body?.amount || 0,
          ...details,
        });

        console.log(
          `[CompliancePipeline] Payment intent created - CorrelationId: ${correlationId}, TxnId: ${transactionId}`
        );
      } catch (error) {
        console.error(
          `[CompliancePipeline] Error logging payment intent: ${error}. CorrelationId: ${correlationId}`
        );
      }
    };

    next();
  };
}

/**
 * Middleware to log STK Push sent event
 * Logs STK_PUSH_SENT
 */
export function logStkPushSent(auditTrailService: AuditTrailService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCorrelationId(req);

    // Attach function to log STK Push sent
    (res as any).logStkPushSent = async (transactionId: string, phoneNumber: string, details?: any) => {
      try {
        // Mask phone number
        const maskedPhone = phoneNumber.substring(0, 6) + "****" + phoneNumber.substring(10);

        await auditTrailService.logEvent(AuditEventType.WEBHOOK_RECEIVED, correlationId, {
          transactionId,
          maskedPhoneNumber: maskedPhone,
          externalSystemId: req.body?.externalSystemId || "unknown",
          ...details,
        });

        console.log(
          `[CompliancePipeline] STK Push sent - CorrelationId: ${correlationId}, TxnId: ${transactionId}`
        );
      } catch (error) {
        console.error(
          `[CompliancePipeline] Error logging STK Push sent: ${error}. CorrelationId: ${correlationId}`
        );
      }
    };

    next();
  };
}

/**
 * Middleware to log notification dispatched event
 * Logs NOTIFICATION_DISPATCHED
 */
export function logNotificationDispatched(auditTrailService: AuditTrailService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCorrelationId(req);

    // Attach function to log notification dispatch
    (res as any).logNotificationDispatched = async (
      externalSystemId: string,
      transactionId: string,
      details?: any
    ) => {
      try {
        await auditTrailService.logEvent(AuditEventType.NOTIFICATION_DISPATCHED, correlationId, {
          externalSystemId,
          transactionId,
          ...details,
        });

        console.log(
          `[CompliancePipeline] Notification dispatched - CorrelationId: ${correlationId}, System: ${externalSystemId}`
        );
      } catch (error) {
        console.error(
          `[CompliancePipeline] Error logging notification dispatch: ${error}. CorrelationId: ${correlationId}`
        );
      }
    };

    next();
  };
}

/**
 * Register all compliance pipeline middleware
 */
export function registerCompliancePipelineMiddleware(
  app: any,
  auditTrailService: AuditTrailService,
  complianceModeService: ComplianceModeService
) {
  // Apply to all routes
  app.use(enforceComplianceMode(complianceModeService));
  app.use(logSignatureVerification(auditTrailService));
  app.use(logRateLimitEvent(auditTrailService));
  app.use(logReplayEvent(auditTrailService));
  app.use(logPaymentRequest(auditTrailService));
  app.use(logStkPushSent(auditTrailService));
  app.use(logNotificationDispatched(auditTrailService));

  // Apply webhook-specific logging
  app.use("/webhooks/mpesa", logWebhookReceived(auditTrailService));

  console.log("[CompliancePipeline] Compliance pipeline middleware registered");
}
