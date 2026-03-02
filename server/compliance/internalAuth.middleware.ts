/**
 * Internal Authentication Middleware
 * 
 * Protects internal-only endpoints with API key authentication.
 * Used for audit export, security metrics, and compliance endpoints.
 */

import { Request, Response, NextFunction } from "express";

export interface InternalAuthConfig {
  apiKeyHeader?: string;
  apiKeyEnvVar?: string;
  allowedRoles?: string[];
}

const DEFAULT_CONFIG: InternalAuthConfig = {
  apiKeyHeader: "X-Internal-API-Key",
  apiKeyEnvVar: "INTERNAL_API_KEY",
  allowedRoles: ["admin", "compliance", "auditor"],
};

/**
 * Middleware to verify internal API key
 */
export function internalAuthMiddleware(config: InternalAuthConfig = DEFAULT_CONFIG) {
  return (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers[config.apiKeyHeader?.toLowerCase() || "x-internal-api-key"];
    const expectedKey = process.env[config.apiKeyEnvVar || "INTERNAL_API_KEY"];

    if (!expectedKey) {
      console.warn(
        `[InternalAuth] ${config.apiKeyEnvVar || "INTERNAL_API_KEY"} environment variable not set`
      );
      return res.status(500).json({
        error: "Internal server error - authentication not configured",
      });
    }

    if (!apiKey) {
      console.warn(`[InternalAuth] Missing API key header: ${config.apiKeyHeader}`);
      return res.status(401).json({
        error: "Unauthorized - missing API key",
      });
    }

    // Timing-safe comparison to prevent timing attacks
    const isValid = timingSafeEqual(String(apiKey), expectedKey);

    if (!isValid) {
      console.warn(`[InternalAuth] Invalid API key provided from IP: ${req.ip}`);
      return res.status(401).json({
        error: "Unauthorized - invalid API key",
      });
    }

    // Attach auth info to request
    (req as any).internalAuth = {
      authenticated: true,
      apiKey: "***" + String(apiKey).substring(String(apiKey).length - 4),
      timestamp: Date.now(),
    };

    console.log(`[InternalAuth] Authenticated internal request from IP: ${req.ip}`);
    next();
  };
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still compare to avoid timing leak
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      // Do nothing, just iterate
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Middleware to verify internal request is authenticated
 */
export function requireInternalAuth(req: Request, res: Response, next: NextFunction) {
  const auth = (req as any).internalAuth;

  if (!auth || !auth.authenticated) {
    return res.status(401).json({
      error: "Unauthorized - internal authentication required",
    });
  }

  next();
}

/**
 * Middleware to log internal API access
 */
export function logInternalApiAccess(req: Request, res: Response, next: NextFunction) {
  const originalSend = res.send;

  res.send = function (data: any) {
    const auth = (req as any).internalAuth;
    const statusCode = res.statusCode;

    console.log(
      `[InternalAPI] ${req.method} ${req.path} - Status: ${statusCode} - Auth: ${auth?.apiKey || "unauthenticated"}`
    );

    return originalSend.call(this, data);
  };

  next();
}

/**
 * Middleware to rate limit internal API endpoints
 */
export function rateLimitInternalApi(maxRequests: number = 100, windowMs: number = 60000) {
  const requestCounts = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = (req as any).internalAuth?.apiKey || req.ip || "unknown";
    const now = Date.now();

    let record = requestCounts.get(key);

    if (!record || now > record.resetTime) {
      record = { count: 0, resetTime: now + windowMs };
      requestCounts.set(key, record);
    }

    record.count++;

    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - record.count));
    res.setHeader("X-RateLimit-Reset", new Date(record.resetTime).toISOString());

    if (record.count > maxRequests) {
      console.warn(
        `[InternalAPI] Rate limit exceeded for key: ${key} (${record.count}/${maxRequests})`
      );
      return res.status(429).json({
        error: "Too many requests - rate limit exceeded",
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      });
    }

    next();
  };
}
