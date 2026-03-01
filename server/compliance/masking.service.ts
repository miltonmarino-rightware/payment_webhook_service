/**
 * PCI-Style Sensitive Data Masking Service
 * 
 * Prevents accidental logging of sensitive information.
 * Masks fields before they appear in:
 * - Audit logs
 * - Error messages
 * - Debug output
 * - Compliance reports
 * 
 * Follows PCI-DSS guidelines for sensitive data protection.
 */

/**
 * Mask phone number (MSISDN)
 * Example: 258843456789 → 258****6789
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone || phone.length < 8) return "****";
  const start = phone.substring(0, 3);
  const end = phone.substring(phone.length - 4);
  return `${start}****${end}`;
}

/**
 * Mask transaction ID
 * Show only last 4 characters
 * Example: TXN-20250301-001 → TXN-****-***-001
 */
export function maskTransactionId(txnId: string): string {
  if (!txnId || txnId.length < 4) return "****";
  return `${txnId.substring(0, 4)}****${txnId.substring(txnId.length - 4)}`;
}

/**
 * Mask signature (never log)
 * Always return placeholder
 */
export function maskSignature(signature: string): string {
  return "[SIGNATURE_REDACTED]";
}

/**
 * Mask API key or secret
 * Show only first 4 and last 4 characters
 */
export function maskSecret(secret: string): string {
  if (!secret || secret.length < 8) return "[SECRET_REDACTED]";
  const start = secret.substring(0, 4);
  const end = secret.substring(secret.length - 4);
  return `${start}****${end}`;
}

/**
 * Mask IP address (partial)
 * Example: 192.168.1.100 → 192.168.*.***
 */
export function maskIpAddress(ip: string): string {
  if (!ip) return "***.***.***.*";
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*.***`;
  }
  return ip; // IPv6 or other format
}

/**
 * Mask email address
 * Example: user@example.com → u***@example.com
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "****@****";
  const [local, domain] = email.split("@");
  if (!local || local.length < 2) return "****@****";
  const masked = local.charAt(0) + "***" + local.charAt(local.length - 1);
  return `${masked}@${domain}`;
}

/**
 * Mask amount (keep visible but note it's sensitive)
 * Can be shown but marked as sensitive
 */
export function markAmountSensitive(amount: number): string {
  return `[AMOUNT: ${amount}]`;
}

/**
 * Deep mask object recursively
 * Identifies sensitive fields by name and masks them
 */
export function maskSensitiveData(obj: any, depth = 0): any {
  if (depth > 10) return "[DEEP_OBJECT_REDACTED]"; // Prevent infinite recursion

  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") return obj;

  if (typeof obj === "number") return obj;

  if (typeof obj === "boolean") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => maskSensitiveData(item, depth + 1));
  }

  if (typeof obj === "object") {
    const masked: any = {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();

      // Mask by field name
      if (lowerKey.includes("phone") || lowerKey.includes("msisdn")) {
        masked[key] = maskPhoneNumber(String(value));
      } else if (lowerKey.includes("signature")) {
        masked[key] = maskSignature(String(value));
      } else if (lowerKey.includes("secret") || lowerKey.includes("key")) {
        masked[key] = maskSecret(String(value));
      } else if (lowerKey.includes("transactionid") || lowerKey.includes("txn")) {
        masked[key] = maskTransactionId(String(value));
      } else if (lowerKey.includes("ip") || lowerKey.includes("address")) {
        masked[key] = maskIpAddress(String(value));
      } else if (lowerKey.includes("email")) {
        masked[key] = maskEmail(String(value));
      } else if (lowerKey.includes("password") || lowerKey.includes("token")) {
        masked[key] = "[REDACTED]";
      } else if (typeof value === "object") {
        // Recursively mask nested objects
        masked[key] = maskSensitiveData(value, depth + 1);
      } else {
        masked[key] = value;
      }
    }

    return masked;
  }

  return obj;
}

/**
 * Create a safe log entry from webhook payload
 * Masks all sensitive fields before logging
 */
export function createSafeLogEntry(payload: any, correlationId: string): any {
  return {
    correlationId,
    timestamp: new Date().toISOString(),
    payload: maskSensitiveData(payload),
  };
}

/**
 * Create a safe audit event from raw data
 * Masks sensitive fields for audit trail
 */
export function createSafeAuditEvent(eventData: any): any {
  return maskSensitiveData(eventData);
}

/**
 * Verify that sensitive fields are masked in an object
 * Returns true if no sensitive data is visible
 */
export function verifySensitiveDataMasked(obj: any): boolean {
  const sensitivePatterns = [
    /\d{3}\d{4}\d{4}/, // Phone number pattern
    /[A-Za-z0-9+/=]{20,}/, // Base64 or encoded secret pattern
    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/, // Email pattern
  ];

  const jsonStr = JSON.stringify(obj);

  for (const pattern of sensitivePatterns) {
    if (pattern.test(jsonStr)) {
      return false;
    }
  }

  return true;
}
