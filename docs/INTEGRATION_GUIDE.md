# GATEAWAY Merchant Integration Guide

## Scope

This guide documents the stable merchant-facing contract used by an application integrating with GATEAWAY. The application never sends card numbers, CVV, PINs or provider credentials to GATEAWAY.

## Environments

- Local sandbox: `http://localhost:3000`
- Provider `mock`: deterministic local development without PaySuite credentials
- Provider `paysuite`: disabled until official credentials and final provider contract are configured

Keep separate API keys and webhook secrets for test and production.

## Authentication

Every `/v1` request requires:

```http
x-api-key: gw_test_...
```

API keys are shown once when created. GATEAWAY stores only a SHA-256 hash and a non-secret prefix. A revoked, expired or unknown key returns:

```json
{"error":"invalid_api_key"}
```

A missing key returns:

```json
{"error":"api_key_required"}
```

## Idempotency

`POST /v1/payment_intents` and `POST /v1/payment_intents/{id}/confirm` require:

```http
idempotency-key: unique-operation-key
```

Retry the exact same request with the same key after network timeouts. GATEAWAY returns the original result. Reusing the key with a different payload returns HTTP 409:

```json
{"error":"idempotency_key_reused_with_different_payload"}
```

Use a new key for each logical operation. A UUID is recommended.

## Create a Payment Intent

```http
POST /v1/payment_intents
content-type: application/json
x-api-key: <merchant-api-key>
idempotency-key: <unique-key>
```

```json
{
  "amount": 850,
  "currency": "MZN",
  "orderReference": "ORDER-001",
  "description": "Order payment",
  "metadata": {"source":"checkout"}
}
```

The merchant identity is derived from the API key. Do not trust or require a client-supplied merchant ID.

## Confirm a Payment Intent

Sandbox example:

```http
POST /v1/payment_intents/pi_.../confirm
content-type: application/json
x-api-key: <merchant-api-key>
idempotency-key: <unique-key>
```

```json
{
  "paymentMethod": "mpesa",
  "customerPhone": "258840000001",
  "provider": "mock"
}
```

`mpesa` and `emola` require `customerPhone`. In sandbox, `GATEAWAY_MOCK_SCENARIO` supports:

- `processing` (default)
- `succeeded`
- `fail`

The mock provider never contacts a payment operator and never moves money.

## Retrieve a Payment Intent

```http
GET /v1/payment_intents/pi_...
x-api-key: <merchant-api-key>
```

A merchant cannot read another merchant's Payment Intent. GATEAWAY returns HTTP 404 instead of revealing that the resource exists.

## Payment states

- `requires_payment_method`
- `requires_confirmation`
- `processing`
- `succeeded`
- `failed`
- `cancelled`
- `expired`

Treat the outbound webhook as the asynchronous notification and use `GET /v1/payment_intents/{id}` for recovery/reconciliation.

## Public error catalogue

| HTTP | Error | Meaning |
|---|---|---|
| 400 | `invalid_amount` | Amount is not positive/valid |
| 400 | `unsupported_currency` | Only MZN is currently supported |
| 400 | `customer_phone_required` | Mobile payment requires a phone |
| 400 | `idempotency_key_required` | Missing idempotency header |
| 401 | `api_key_required` | Missing API key |
| 401 | `invalid_api_key` | Invalid, expired or revoked key |
| 403 | `insufficient_scope` | API key lacks required permission |
| 404 | `payment_intent_not_found` | Not found or owned by another merchant |
| 409 | `idempotency_key_reused_with_different_payload` | Key reused for another operation |
| 409 | `payment_intent_not_confirmable` | Current state cannot be confirmed |
| 429 | `rate_limit_exceeded` | Merchant request limit exceeded |
| 503 | `provider_not_configured` | Requested provider is unavailable |
| 503 | `rate_limit_unavailable` | Redis/rate limit enforcement unavailable |

Internal exception details and provider secrets must never be returned to merchants.

## Outbound webhooks

GATEAWAY sends status events to the URL configured for the merchant.

Headers:

```http
content-type: application/json
x-gateway-event-id: evt_...
x-gateway-timestamp: 1784817402
x-gateway-signature: sha256=<hex-hmac>
```

Signature input:

```text
<timestamp>.<raw-request-body>
```

Verify HMAC-SHA256 with the merchant webhook secret, use constant-time comparison, reject timestamps outside a five-minute window and store `x-gateway-event-id` uniquely before applying business changes.

Event types:

- `payment_intent.processing`
- `payment_intent.succeeded`
- `payment_intent.failed`
- `payment_intent.cancelled`
- `payment_intent.expired`

Return HTTP 2xx quickly after durable receipt. GATEAWAY retries retryable failures with exponential backoff and eventually moves exhausted events to dead-letter.

## Required integration behaviour

1. Create an internal order before creating the Payment Intent.
2. Store the GATEAWAY Payment Intent ID against the order.
3. Never mark an order paid from a frontend redirect alone.
4. Verify the signed outbound webhook.
5. Apply the event idempotently.
6. Reconcile uncertain states with the GET endpoint.
7. Never log API keys, webhook secrets, customer PINs or full card data.

The machine-readable contract is in `openapi/gateaway.openapi.yaml`.
