/**
 * LEGAL COMPLIANCE NOTICE
 *
 * This module implements HMAC-SHA256 signature generation for outbound notifications
 * sent to internal systems. Ensures:
 * - Integrity of notification payload
 * - Authenticity of sender (this service)
 * - Non-repudiation (cannot deny sending notification)
 * - End-to-end security (ponta-a-ponta)
 *
 * This service does NOT handle, store, or move money.
 * Signatures are security-only, no financial logic.
 */

import crypto from "crypto";

/**
 * Configuration for outbound notification signing
 */
export interface NotificationSigningConfig {
  headerName: string; // Header name for signature (e.g., X-Internal-Signature)
  secretPrefix: string; // Prefix for secret env vars (e.g., INTERNAL_WEBHOOK_SECRET_)
  defaultSecret?: string; // Fallback secret if system-specific not found
}

/**
 * Audit log entry for signature generation
 */
export interface SignatureAuditLog {
  event: "OUTBOUND_SIGNATURE_CREATED" | "OUTBOUND_NOTIFICATION_SIGNED";
  timestamp: Date;
  externalSystemId: string;
  paymentId: number;
  signatureHash?: string; // First 8 chars of signature for audit trail
}

/**
 * Default configuration for outbound notification signing
 */
export const defaultNotificationSigningConfig: NotificationSigningConfig = {
  headerName: "X-Internal-Signature",
  secretPrefix: "INTERNAL_WEBHOOK_SECRET_",
  defaultSecret: process.env.INTERNAL_NOTIFICATION_SECRET || "",
};

/**
 * Get the secret for a specific external system
 *
 * Supports per-system secrets via environment variables:
 * - INTERNAL_WEBHOOK_SECRET_<externalSystemId>
 * - INTERNAL_WEBHOOK_SECRET_restaurant-pos-001
 * - INTERNAL_WEBHOOK_SECRET_ecommerce-api-002
 *
 * Falls back to default secret if system-specific not found.
 *
 * @param externalSystemId System identifier (e.g., "restaurant-pos-001")
 * @param config Signing configuration
 * @returns Secret key for the system
 * @throws Error if no secret found for system
 */
export function getSystemSecret(
  externalSystemId: string,
  config: NotificationSigningConfig = defaultNotificationSigningConfig
): string {
  // Try system-specific secret first
  const systemSecretKey = `${config.secretPrefix}${externalSystemId.toUpperCase()}`;
  const systemSecret = process.env[systemSecretKey];

  if (systemSecret) {
    return systemSecret;
  }

  // Fall back to default secret
  if (config.defaultSecret) {
    return config.defaultSecret;
  }

  // No secret found
  throw new Error(
    `No secret configured for external system "${externalSystemId}". ` +
      `Set ${systemSecretKey} environment variable or provide default secret.`
  );
}

/**
 * Calculate HMAC-SHA256 signature for notification payload
 *
 * @param payload Notification payload object
 * @param secret Shared secret key with external system
 * @returns Hex-encoded HMAC-SHA256 signature
 */
export function calculateNotificationSignature(
  payload: Record<string, unknown>,
  secret: string
): string {
  // Serialize payload consistently (sorted keys for deterministic output)
  const payloadStr = JSON.stringify(payload, Object.keys(payload).sort());

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payloadStr, "utf-8");

  return hmac.digest("hex");
}

/**
 * Sign a notification payload for sending to external system
 *
 * Adds signature to payload and returns both payload and signature header value.
 *
 * @param payload Notification payload to sign
 * @param externalSystemId System identifier
 * @param config Signing configuration
 * @returns Object with signed payload and signature header value
 * @throws Error if system secret not configured
 */
export function signNotification(
  payload: Record<string, unknown>,
  externalSystemId: string,
  config: NotificationSigningConfig = defaultNotificationSigningConfig
): {
  signedPayload: Record<string, unknown>;
  signature: string;
  signatureHash: string; // First 8 chars for audit trail
} {
  // Get secret for this system
  const secret = getSystemSecret(externalSystemId, config);

  // Calculate signature
  const signature = calculateNotificationSignature(payload, secret);

  // Create signed payload (with signature included in body for reference)
  const signedPayload = {
    ...payload,
    signature, // Include signature in payload for verification
  };

  // Return signature hash for audit logging (first 8 chars)
  const signatureHash = signature.substring(0, 8);

  return {
    signedPayload,
    signature,
    signatureHash,
  };
}

/**
 * Verify notification signature (for testing/validation)
 *
 * Used by external systems to verify notifications came from this service.
 *
 * @param payload Notification payload
 * @param receivedSignature Signature from header
 * @param externalSystemId System identifier
 * @param config Signing configuration
 * @returns Verification result
 */
export function verifyNotificationSignature(
  payload: Record<string, unknown>,
  receivedSignature: string,
  externalSystemId: string,
  config: NotificationSigningConfig = defaultNotificationSigningConfig
): {
  valid: boolean;
  reason?: string;
} {
  try {
    // Get secret for this system
    const secret = getSystemSecret(externalSystemId, config);

    // Calculate expected signature
    const expectedSignature = calculateNotificationSignature(payload, secret);

    // Compare using timing-safe comparison
    const signaturesMatch = crypto.timingSafeEqual(
      Buffer.from(receivedSignature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );

    if (!signaturesMatch) {
      return {
        valid: false,
        reason: "Signature mismatch",
      };
    }

    return {
      valid: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      reason: errorMessage,
    };
  }
}

/**
 * Create audit logger function for signature events
 *
 * Logs security events for outbound signatures.
 *
 * @param logFunction Function to call for each audit log
 * @returns Async function that logs signature events
 */
export function createNotificationSignatureAuditLogger(
  logFunction: (event: string, details: Record<string, unknown>) => Promise<void>
) {
  return async (log: SignatureAuditLog) => {
    await logFunction(log.event, {
      timestamp: log.timestamp,
      externalSystemId: log.externalSystemId,
      paymentId: log.paymentId,
      signatureHash: log.signatureHash,
    });
  };
}

/**
 * Build notification payload with signature
 *
 * Convenience function that builds complete notification payload
 * and signs it in one step.
 *
 * @param paymentData Payment information
 * @param externalSystemId System identifier
 * @param config Signing configuration
 * @returns Complete signed notification ready to send
 */
export function buildSignedNotification(
  paymentData: {
    id: number;
    transactionId: string;
    status: string;
    amount: string;
    currency: string;
    externalSystemId: string;
  },
  externalSystemId: string,
  config: NotificationSigningConfig = defaultNotificationSigningConfig
): {
  payload: Record<string, unknown>;
  signature: string;
  headers: Record<string, string>;
} {
  // Build base payload
  const payload = {
    event: `payment.${paymentData.status.toLowerCase()}`,
    paymentId: paymentData.id,
    transactionId: paymentData.transactionId,
    status: paymentData.status,
    amount: paymentData.amount,
    currency: paymentData.currency,
    externalSystemId: paymentData.externalSystemId,
    timestamp: new Date().toISOString(),
  };

  // Sign payload
  const { signedPayload, signature } = signNotification(payload, externalSystemId, config);

  // Build headers
  const headers = {
    "Content-Type": "application/json",
    [config.headerName]: signature,
  };

  return {
    payload: signedPayload,
    signature,
    headers,
  };
}

/**
 * Validate notification signature configuration
 *
 * Checks that all required secrets are configured for a list of systems.
 *
 * @param externalSystemIds List of system identifiers
 * @param config Signing configuration
 * @returns Validation result with any missing configurations
 */
export function validateSignatureConfiguration(
  externalSystemIds: string[],
  config: NotificationSigningConfig = defaultNotificationSigningConfig
): {
  valid: boolean;
  missingSecrets: string[];
} {
  const missingSecrets: string[] = [];

  for (const systemId of externalSystemIds) {
    try {
      getSystemSecret(systemId, config);
    } catch {
      missingSecrets.push(systemId);
    }
  }

  return {
    valid: missingSecrets.length === 0,
    missingSecrets,
  };
}
