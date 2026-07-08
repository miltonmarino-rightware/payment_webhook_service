# GATEAWAY v0.1 Implementation Plan

## Goal

Evolve the current internal payment orchestrator into a modular payment gateway while keeping the existing webhook/orchestration logic intact.

## Non-negotiable architecture rule

Clients must integrate with GATEAWAY, not directly with Paysuite.

```text
Client -> GATEAWAY API -> Provider Adapter -> Paysuite -> Payment rails
```

## v0.1 Public API

```http
POST /v1/payment_intents
GET  /v1/payment_intents/:id
POST /v1/payment_intents/:id/confirm
POST /v1/webhooks/paysuite
```

## Core modules

```text
server/gateway/
  payment-intents/
  providers/
  webhooks/
  checkout/
  merchants/
  api-keys/
  events/
```

## First provider

Paysuite will be implemented as the first provider adapter. Future providers must implement the same provider contract.

## Payment Intent lifecycle

```text
requires_payment_method
requires_confirmation
processing
succeeded
failed
cancelled
expired
```

## Next engineering steps

1. Add database schema for payment intents.
2. Implement PaymentIntent service using the database, not memory.
3. Mount `/v1` gateway routes in `server/_core/index.ts`.
4. Add Paysuite API credentials through environment variables.
5. Implement Paysuite create-payment call.
6. Implement Paysuite webhook normalization.
7. Add tests for creation, confirmation, idempotency, and webhook status updates.
