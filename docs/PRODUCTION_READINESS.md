# GATEAWAY Production Readiness

## Mandatory infrastructure

- PostgreSQL with encrypted backups, point-in-time recovery and restricted application role.
- Redis with authentication, TLS in transit where supported, persistence and network isolation.
- HTTPS termination at a trusted reverse proxy or load balancer.
- Central secret manager. Production secrets must never be stored in `.env` files committed to Git.

## Mandatory secrets

- `DATABASE_URL`
- `REDIS_URL`
- `GATEAWAY_DATA_ENCRYPTION_KEY`
- `GATEAWAY_DATA_ENCRYPTION_KEY_VERSION`
- `PAYSUITE_API_TOKEN` when the account is approved
- `PAYSUITE_WEBHOOK_SECRET`
- `INTERNAL_OPERATIONS_TOKEN`

Generate independent random values for each environment. Rotate merchant API keys and webhook secrets with an overlap window; revoke the old credential only after consumers confirm the new one.

## Runtime controls

- `GET /api/health/live`: confirms that the process is alive.
- `GET /api/health/ready`: returns HTTP 200 only when PostgreSQL and Redis are available.
- `GET /internal/metrics`: requires `X-Internal-Operations-Token`.
- Graceful shutdown stops queue processors, stops accepting new HTTP requests and closes Redis.
- Stuck outbound deliveries are returned to `retrying` after five minutes.
- Dead-letter events emit an operational alert in application logs.

## Recommended variables

```text
NODE_ENV=production
PORT=3000
REQUEST_BODY_LIMIT=1mb
CORS_ALLOWED_ORIGINS=https://your-system.example
OUTBOUND_WEBHOOK_TIMEOUT_MS=10000
OUTBOUND_WEBHOOK_PROCESSOR_INTERVAL_MS=5000
OUTBOUND_WEBHOOK_RETENTION_DAYS=180
OPERATIONS_MAINTENANCE_INTERVAL_MS=60000
GRACEFUL_SHUTDOWN_TIMEOUT_MS=15000
```

## Retention

`pnpm operations:maintenance` removes expired idempotency records and delivered outbound webhook records older than the configured retention period. It does not delete financial transaction logs or provider webhook audit records.

## Pre-provider checklist

- Official provider endpoints, headers, signatures and payloads verified from current documentation.
- Sandbox certification completed.
- Incoming webhook allow-list or mTLS enabled when supported.
- Reconciliation job implemented against an official provider status endpoint.
- Alerts connected to the organisation's monitoring channel.
- Backup restoration tested.
- Incident response, key compromise and provider outage procedures rehearsed.
- Penetration test and dependency review completed.

A passing local test suite is necessary but is not a guarantee of total security. Production approval requires infrastructure hardening, provider certification, monitoring and independent security review.
