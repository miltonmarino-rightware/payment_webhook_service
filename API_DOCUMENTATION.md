# GATEAWAY API Documentation

This file is the entry point for the current merchant integration contract.

## Canonical sources

- Machine-readable OpenAPI: `openapi/gateaway.openapi.yaml`
- Merchant integration guide: `docs/INTEGRATION_GUIDE.md`
- TypeScript example: `examples/typescript/gateaway-client.ts`
- Java/Spring-compatible example: `examples/java/GateawayClient.java`
- Postman collection: `postman/GATEAWAY.postman_collection.json`

## Current public API

```text
GET  /api/health
POST /v1/payment_intents
GET  /v1/payment_intents/:id
POST /v1/payment_intents/:id/confirm
```

All `/v1` routes require a merchant API key. Create and confirm operations also require an `idempotency-key` header.

## Sandbox provider

Use provider `mock` while PaySuite credentials and the final official provider contract are unavailable.

```json
{
  "paymentMethod": "mpesa",
  "customerPhone": "258840000001",
  "provider": "mock"
}
```

The mock provider never contacts an operator and never moves money. `GATEAWAY_MOCK_SCENARIO` supports `processing`, `succeeded` and `fail`.

## Webhooks

Inbound PaySuite webhooks and outbound merchant webhooks use timestamp-bound HMAC signatures. The exact PaySuite inbound contract must be verified against official current PaySuite documentation before production use.

Outbound merchant signature input:

```text
<timestamp>.<raw-request-body>
```

Headers:

```text
x-gateway-event-id
x-gateway-timestamp
x-gateway-signature: sha256=<hex>
```

Never mark an order paid from a frontend redirect alone. Verify the signed outbound event and process it idempotently.

## Security boundary

GATEAWAY does not receive or store full card numbers, CVV, PINs or merchant provider credentials in public request payloads. Secrets belong in environment variables or a production secret manager and must never be committed to Git.
