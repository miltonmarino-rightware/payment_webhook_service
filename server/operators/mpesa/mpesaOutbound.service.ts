/**
 * LEGAL COMPLIANCE NOTICE
 *
 * This module handles outbound STK Push requests to mPesa operator.
 * This service does NOT handle, store, or move money.
 * Money flows directly from customer → operator/merchant.
 * This service only initiates payment intents via STK Push.
 *
 * All outbound requests must be:
 * - Cryptographically signed (if required by operator)
 * - Logged immutably for audit
 * - Idempotent (safe to retry)
 * - Non-repudiable (signature-based)
 */

import axios, { AxiosError } from "axios";
import { createHmac } from "crypto";

/**
 * Configuration for mPesa STK Push requests
 */
interface MpesaConfig {
  apiUrl: string;
  businessCode: string;
  businessKey: string;
  callbackUrl: string;
  timeout: number;
}

/**
 * STK Push request payload for mPesa
 */
interface StkPushRequest {
  transactionId: string;
  phoneNumber: string;
  amount: number;
  currency: string;
  description: string;
  externalSystemId: string;
}

/**
 * STK Push response from mPesa
 */
interface StkPushResponse {
  success: boolean;
  operatorReference?: string;
  checkoutRequestId?: string;
  responseCode?: string;
  responseMessage?: string;
  timestamp: string;
  error?: string;
}

/**
 * Get mPesa configuration from environment variables
 */
function getMpesaConfig(): MpesaConfig {
  const apiUrl = process.env.MPESA_API_URL || "https://api.sandbox.m-pesa.com";
  const businessCode = process.env.MPESA_BUSINESS_CODE || "";
  const businessKey = process.env.MPESA_BUSINESS_KEY || "";
  const callbackUrl = process.env.MPESA_CALLBACK_URL || "";
  const timeout = parseInt(process.env.MPESA_REQUEST_TIMEOUT || "30000", 10);

  if (!businessCode || !businessKey) {
    throw new Error(
      "Missing required mPesa credentials: MPESA_BUSINESS_CODE and MPESA_BUSINESS_KEY"
    );
  }

  return {
    apiUrl,
    businessCode,
    businessKey,
    callbackUrl,
    timeout,
  };
}

/**
 * Build STK Push payload for mPesa
 *
 * This constructs the exact payload format expected by mPesa operator.
 * Format is operator-specific and must match mPesa API specification.
 */
function buildStkPushPayload(
  request: StkPushRequest,
  config: MpesaConfig
): Record<string, unknown> {
  // Normalize phone number: remove leading 0 or +, ensure starts with country code
  let normalizedPhone = request.phoneNumber.replace(/^\+?258/, "");
  if (normalizedPhone.startsWith("0")) {
    normalizedPhone = normalizedPhone.substring(1);
  }
  normalizedPhone = `258${normalizedPhone}`;

  // Build payload according to mPesa STK Push specification
  const payload = {
    BusinessShortCode: config.businessCode,
    Password: generateMpesaPassword(config.businessCode, config.businessKey),
    Timestamp: generateTimestamp(),
    TransactionType: "CustomerPaymentRequest", // STK Push type
    Amount: Math.round(request.amount * 100) / 100, // Ensure 2 decimal places
    PartyA: normalizedPhone,
    PartyB: config.businessCode,
    PhoneNumber: normalizedPhone,
    CallBackURL: config.callbackUrl,
    AccountReference: request.transactionId,
    TransactionDesc: request.description,
    Remark: `Payment for ${request.externalSystemId}`,
  };

  return payload;
}

/**
 * Generate mPesa password (Base64 encoded: BusinessShortCode + BusinessKey + Timestamp)
 */
function generateMpesaPassword(
  businessCode: string,
  businessKey: string
): string {
  const timestamp = generateTimestamp();
  const data = `${businessCode}${businessKey}${timestamp}`;
  return Buffer.from(data).toString("base64");
}

/**
 * Generate timestamp in format: YYYYMMDDHHmmss
 */
function generateTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * Send STK Push request to mPesa operator
 *
 * This initiates a payment request that prompts the customer to enter their PIN.
 * The request is sent to the mPesa API endpoint.
 *
 * @param request - Payment request details
 * @returns STK Push response with operator reference or error
 */
export async function sendStkPushRequest(
  request: StkPushRequest
): Promise<StkPushResponse> {
  try {
    const config = getMpesaConfig();

    // Build payload
    const payload = buildStkPushPayload(request, config);

    // Log outbound request (without sensitive data)
    console.log(`[mPesa Outbound] Sending STK Push for transaction ${request.transactionId}`);

    // Send request to mPesa API
    const response = await axios.post(
      `${config.apiUrl}/mpesa/stkpush/v1/processrequest`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: config.timeout,
      }
    );

    // Parse operator response
    const operatorData = response.data;

    // Check if request was accepted by operator
    if (operatorData.ResponseCode === "0") {
      console.log(
        `[mPesa Outbound] STK Push accepted for transaction ${request.transactionId}`
      );

      return {
        success: true,
        operatorReference: operatorData.MerchantRequestID,
        checkoutRequestId: operatorData.CheckoutRequestID,
        responseCode: operatorData.ResponseCode,
        responseMessage: operatorData.ResponseDescription,
        timestamp: new Date().toISOString(),
      };
    } else {
      // Operator rejected request
      console.warn(
        `[mPesa Outbound] STK Push rejected for transaction ${request.transactionId}: ${operatorData.ResponseDescription}`
      );

      return {
        success: false,
        responseCode: operatorData.ResponseCode,
        responseMessage: operatorData.ResponseDescription,
        timestamp: new Date().toISOString(),
        error: operatorData.ResponseDescription,
      };
    }
  } catch (error) {
    // Handle network or parsing errors
    const axiosError = error as AxiosError;
    const errorMessage =
      axiosError.message || "Unknown error sending STK Push request";

    console.error(
      `[mPesa Outbound] Error sending STK Push for transaction ${request.transactionId}: ${errorMessage}`
    );

    return {
      success: false,
      timestamp: new Date().toISOString(),
      error: errorMessage,
    };
  }
}

/**
 * Verify mPesa callback signature (if operator uses signature verification)
 *
 * Some operators may sign their callbacks. This function verifies the signature.
 */
export function verifyMpesaCallbackSignature(
  payload: Record<string, unknown>,
  signature: string,
  secret: string
): boolean {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const expectedSignature = createHmac("sha256", secret)
    .update(canonical)
    .digest("hex");

  return expectedSignature === signature;
}

/**
 * Extract operator reference from mPesa callback
 *
 * Parses the callback payload to extract the operator's transaction reference.
 */
export function extractOperatorReference(
  callbackPayload: Record<string, unknown>
): string | null {
  // mPesa returns MerchantRequestID or CheckoutRequestID
  return (
    (callbackPayload.MerchantRequestID as string) ||
    (callbackPayload.CheckoutRequestID as string) ||
    null
  );
}

/**
 * Check if mPesa callback indicates successful payment
 *
 * Parses callback to determine payment success status.
 */
export function isPaymentSuccessful(
  callbackPayload: Record<string, unknown>
): boolean {
  // mPesa returns ResultCode 0 for success
  const body = callbackPayload.Body as any;
  const resultCode = body?.stkCallback?.ResultCode;
  return resultCode === 0;
}

/**
 * Extract payment details from mPesa callback
 *
 * Parses the callback to extract amount, phone, and other details.
 */
export function extractPaymentDetails(
  callbackPayload: Record<string, unknown>
): {
  amount: number;
  phoneNumber: string;
  timestamp: string;
} | null {
  try {
    const body = callbackPayload.Body as any;
    const stkCallback = body?.stkCallback;
    if (!stkCallback) return null;

    const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
    const details: Record<string, unknown> = {};

    // Extract metadata items
    for (const item of callbackMetadata) {
      details[item.Name] = item.Value;
    }

    return {
      amount: parseFloat(details.Amount as string) || 0,
      phoneNumber: (details.PhoneNumber as string) || "",
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[mPesa Outbound] Error extracting payment details:", error);
    return null;
  }
}
