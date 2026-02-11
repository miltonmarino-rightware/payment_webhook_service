/**
 * LEGAL COMPLIANCE NOTICE
 *
 * This module implements HMAC-SHA256 signature verification for mPesa webhooks.
 * Ensures:
 * - Operator authenticity (only mPesa can send valid signatures)
 * - Payload integrity (no tampering during transit)
 * - Non-repudiation (operator cannot deny sending the webhook)
 * - Replay attack protection (timestamp validation)
 *
 * This service does NOT handle, store, or move money.
 * Signature verification is security-only, no financial logic.
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * Configuration for signature verification
 */
export interface SignatureConfig {
  secret: string;
  headerName: string;
  timestampFieldName: string;
  maxTimestampDiffMs: number; // Default: 5 minutes
}

/**
 * Audit log entry for signature verification
 */
export interface SignatureAuditLog {
  event: "SIGNATURE_VALID" | "SIGNATURE_INVALID" | "REPLAY_ATTACK_BLOCKED" | "MISSING_SIGNATURE";
  timestamp: Date;
  ipAddress: string;
  transactionId?: string;
  reason?: string;
}

/**
 * Default configuration for mPesa signature verification
 */
export const defaultMpesaSignatureConfig: SignatureConfig = {
  secret: process.env.MPESA_WEBHOOK_SECRET || "",
  headerName: "x-mpesa-signature",
  timestampFieldName: "timestamp",
  maxTimestampDiffMs: 5 * 60 * 1000, // 5 minutes
};

/**
 * Timing-safe string comparison to prevent timing attacks
 *
 * Compares two strings in constant time to prevent attackers
 * from determining the correct signature through timing analysis.
 *
 * @param a First string (e.g., received signature)
 * @param b Second string (e.g., calculated signature)
 * @returns true if strings match, false otherwise
 */
export function timingSafeCompare(a: string, b: string): boolean {
  // Convert to buffers for timing-safe comparison
  const bufferA = Buffer.from(a, "utf-8");
  const bufferB = Buffer.from(b, "utf-8");

  // Use crypto.timingSafeEqual for constant-time comparison
  try {
    return crypto.timingSafeEqual(bufferA, bufferB);
  } catch {
    // If lengths differ, timingSafeEqual throws - return false
    return false;
  }
}

/**
 * Calculate HMAC-SHA256 signature for payload
 *
 * @param payload Raw request body (must be exact bytes received)
 * @param secret Shared secret key from mPesa
 * @returns Hex-encoded HMAC-SHA256 signature
 */
export function calculateSignature(payload: Buffer | string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);

  if (typeof payload === "string") {
    hmac.update(payload, "utf-8");
  } else {
    hmac.update(payload);
  }

  return hmac.digest("hex");
}

/**
 * Verify webhook signature
 *
 * Validates that the webhook was sent by mPesa and has not been tampered with.
 *
 * @param rawBody Raw request body (exact bytes received)
 * @param receivedSignature Signature from request header
 * @param config Signature verification configuration
 * @returns Verification result with details
 */
export function verifySignature(
  rawBody: Buffer | string,
  receivedSignature: string,
  config: SignatureConfig
): {
  valid: boolean;
  reason?: string;
} {
  // Validate secret is configured
  if (!config.secret) {
    return {
      valid: false,
      reason: "MPESA_WEBHOOK_SECRET not configured",
    };
  }

  // Validate signature header is present
  if (!receivedSignature || receivedSignature.trim().length === 0) {
    return {
      valid: false,
      reason: "Signature header missing",
    };
  }

  // Calculate expected signature
  const calculatedSignature = calculateSignature(rawBody, config.secret);

  // Compare using timing-safe comparison
  const signaturesMatch = timingSafeCompare(receivedSignature, calculatedSignature);

  if (!signaturesMatch) {
    return {
      valid: false,
      reason: "Signature mismatch",
    };
  }

  return {
    valid: true,
  };
}

/**
 * Validate timestamp is within acceptable window
 *
 * Prevents replay attacks by rejecting webhooks with old timestamps.
 *
 * @param payload Parsed webhook payload
 * @param config Signature verification configuration
 * @returns Validation result
 */
export function validateTimestamp(
  payload: Record<string, unknown>,
  config: SignatureConfig
): {
  valid: boolean;
  reason?: string;
} {
  // Extract timestamp from payload
  const timestamp = payload[config.timestampFieldName];

  if (!timestamp) {
    return {
      valid: false,
      reason: `Timestamp field '${config.timestampFieldName}' missing`,
    };
  }

  // Parse timestamp (support both ISO string and Unix milliseconds)
  let webhookTime: number;

  if (typeof timestamp === "number") {
    webhookTime = timestamp;
  } else if (typeof timestamp === "string") {
    webhookTime = new Date(timestamp).getTime();
  } else {
    return {
      valid: false,
      reason: "Invalid timestamp format",
    };
  }

  // Check if timestamp is valid
  if (isNaN(webhookTime)) {
    return {
      valid: false,
      reason: "Timestamp could not be parsed",
    };
  }

  // Calculate time difference
  const now = Date.now();
  const timeDiff = Math.abs(now - webhookTime);

  // Check if within acceptable window
  if (timeDiff > config.maxTimestampDiffMs) {
    return {
      valid: false,
      reason: `Timestamp outside acceptable window (diff: ${timeDiff}ms, max: ${config.maxTimestampDiffMs}ms)`,
    };
  }

  return {
    valid: true,
  };
}

/**
 * Express middleware for mPesa signature verification
 *
 * Must be applied BEFORE express.json() to access raw body.
 * Verifies:
 * 1. Signature header presence
 * 2. HMAC-SHA256 signature validity
 * 3. Timestamp freshness (replay protection)
 *
 * Usage:
 * ```
 * app.use(express.raw({ type: "application/json" }));
 * app.use(mpesaSignatureMiddleware(config));
 * app.use(express.json());
 * ```
 *
 * @param config Signature verification configuration
 * @param auditLogger Optional function to log security events
 * @returns Express middleware function
 */
export function mpesaSignatureMiddleware(
  config: SignatureConfig = defaultMpesaSignatureConfig,
  auditLogger?: (log: SignatureAuditLog) => Promise<void>
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Only verify mPesa webhook endpoints
      if (!req.path.includes("/webhooks/mpesa")) {
        return next();
      }

      // Get raw body (must be Buffer for signature verification)
      const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));

      // Get signature from header
      const receivedSignature = req.headers[config.headerName] as string;

      // Get client IP for audit logging
      const clientIp =
        (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";

      // Verify signature
      const signatureResult = verifySignature(rawBody, receivedSignature, config);

      if (!signatureResult.valid) {
        // Log failed signature verification
        const auditLog: SignatureAuditLog = {
          event: receivedSignature ? "SIGNATURE_INVALID" : "MISSING_SIGNATURE",
          timestamp: new Date(),
          ipAddress: clientIp,
          reason: signatureResult.reason,
        };

        if (auditLogger) {
          await auditLogger(auditLog);
        }

        // Return 401 Unauthorized
        return res.status(401).json({
          error: "Unauthorized",
          message: "Invalid or missing webhook signature",
        });
      }

      // Parse payload for timestamp validation
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString("utf-8"));
      } catch {
        const auditLog: SignatureAuditLog = {
          event: "SIGNATURE_INVALID",
          timestamp: new Date(),
          ipAddress: clientIp,
          reason: "Invalid JSON payload",
        };

        if (auditLogger) {
          await auditLogger(auditLog);
        }

        return res.status(400).json({
          error: "Bad Request",
          message: "Invalid JSON payload",
        });
      }

      // Validate timestamp (replay protection)
      const timestampResult = validateTimestamp(payload, config);

      if (!timestampResult.valid) {
        // Log replay attack attempt
        const auditLog: SignatureAuditLog = {
          event: "REPLAY_ATTACK_BLOCKED",
          timestamp: new Date(),
          ipAddress: clientIp,
          transactionId: (payload.transactionId as string) || undefined,
          reason: timestampResult.reason,
        };

        if (auditLogger) {
          await auditLogger(auditLog);
        }

        return res.status(401).json({
          error: "Unauthorized",
          message: "Webhook timestamp outside acceptable window",
        });
      }

      // Log successful signature verification
      const auditLog: SignatureAuditLog = {
        event: "SIGNATURE_VALID",
        timestamp: new Date(),
        ipAddress: clientIp,
        transactionId: (payload.transactionId as string) || undefined,
      };

      if (auditLogger) {
        await auditLogger(auditLog);
      }

      // Attach parsed payload to request for downstream handlers
      (req as any).rawBody = rawBody;
      (req as any).parsedPayload = payload;

      // Continue to next middleware
      next();
    } catch (error) {
      console.error("[SECURITY] Error in signature middleware:", error);

      return res.status(500).json({
        error: "Internal Server Error",
        message: "Signature verification failed",
      });
    }
  };
}

/**
 * Create audit logger function for signature events
 *
 * Logs security events to the application's audit trail.
 *
 * @param logFunction Function to call for each audit log
 * @returns Async function that logs signature verification events
 */
export function createSignatureAuditLogger(
  logFunction: (event: string, details: Record<string, unknown>) => Promise<void>
) {
  return async (log: SignatureAuditLog) => {
    await logFunction(log.event, {
      timestamp: log.timestamp,
      ipAddress: log.ipAddress,
      transactionId: log.transactionId,
      reason: log.reason,
    });
  };
}
