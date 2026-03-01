/**
 * Correlation ID Middleware
 * 
 * Implements end-to-end request tracing using correlation IDs.
 * Every request gets a unique correlation ID that flows through:
 * - Request processing
 * - Audit logs
 * - Outbound notifications
 * - Security events
 * 
 * Enables forensic investigation and compliance auditing.
 */

import { Request, Response, NextFunction } from "express";
// @ts-ignore
import { v4 as uuidv4 } from "uuid";

export const CORRELATION_ID_HEADER = "X-Correlation-ID";

/**
 * Attach correlation ID to request and response
 * If header exists, reuse it; otherwise generate new UUID
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  // Check for existing correlation ID in request header
  let correlationId = req.headers[CORRELATION_ID_HEADER.toLowerCase()] as string;

  // If not present, generate new UUID
  if (!correlationId) {
    correlationId = uuidv4();
  }

  // Attach to request object for use in handlers
  (req as any).correlationId = correlationId;

  // Set response header for client
  res.setHeader(CORRELATION_ID_HEADER, correlationId);

  // Add to response locals for easy access in templates/responses
  res.locals.correlationId = correlationId;

  // Log correlation ID for debugging
  console.log(`[CorrelationID] ${correlationId} - ${req.method} ${req.path}`);

  next();
}

/**
 * Get correlation ID from request
 * Safe accessor for handlers and services
 */
export function getCorrelationId(req: Request): string {
  return (req as any).correlationId || "UNKNOWN";
}

/**
 * Get correlation ID from Express Response locals
 * Useful in middleware and error handlers
 */
export function getCorrelationIdFromResponse(res: Response): string {
  return res.locals.correlationId || res.getHeader(CORRELATION_ID_HEADER) || "UNKNOWN";
}

/**
 * Create a correlation ID for internal operations
 * When no HTTP request context exists
 */
export function createCorrelationId(): string {
  return uuidv4();
}

/**
 * Correlation ID context for async operations
 * Maintains correlation ID across async boundaries
 */
export class CorrelationContext {
  private static contextMap = new Map<string, string>();

  /**
   * Set correlation ID for current async context
   */
  static set(contextId: string, correlationId: string): void {
    this.contextMap.set(contextId, correlationId);
  }

  /**
   * Get correlation ID from current async context
   */
  static get(contextId: string): string {
    return this.contextMap.get(contextId) || "UNKNOWN";
  }

  /**
   * Remove correlation ID from context
   */
  static delete(contextId: string): void {
    this.contextMap.delete(contextId);
  }

  /**
   * Clear all contexts (for testing)
   */
  static clear(): void {
    this.contextMap.clear();
  }
}
