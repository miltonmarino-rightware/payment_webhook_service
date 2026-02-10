# Internal Payment Orchestrator

**⚠️ PRIVATE BACKEND SERVICE - NOT FOR PUBLIC USE**

This is a **private, internal-only backend service** for orchestrating payment transactions within your organization. It is **NOT** a public-facing application, **NOT** a licensed payment gateway, and **NOT** a financial service.

---

## Critical Legal Notice

**This service does NOT:**
- Receive, store, or move money
- Maintain customer balances or wallets
- Process card payments directly
- Hold customer funds
- Operate as a payment processor or gateway
- Provide financial services to end users

**This service ONLY:**
- Orchestrates payment intentions via webhooks
- Tracks payment confirmation events
- Maintains audit trails for internal systems
- Notifies internal systems of payment outcomes
- Routes payment events between operators and internal systems

**Money flows directly from customer → operator/merchant. This service never touches funds.**

---

## Service Overview

The **Internal Payment Orchestrator** is a backend service that coordinates payment transactions between your internal systems (e.g., restaurant POS, e-commerce platform) and external payment operators (e.g., mPesa, Stripe).

### Architecture

```
Internal System          Payment Orchestrator         Payment Operator
(Restaurant POS)              (This Service)              (mPesa)
     |                              |                         |
     |--1. Initiate Payment-------->|                         |
     |                              |--2. Forward to Operator-|
     |                              |                         |
     |                              |<--3. Webhook Event------|
     |<--4. Notify Result-----------|                         |
     |                              |
```

### Key Characteristics

- **Backend-Only**: No user interface, no direct user interaction
- **Event-Driven**: Operates on webhook events from payment operators
- **Stateless Processing**: Transactions are immutable once completed
- **Multi-Tenant**: Supports multiple internal systems (food, retail, etc.)
- **Audit-First**: Every event is logged for compliance
- **Idempotent**: Safe to retry failed requests

---

## Deployment Model

### Intended Use

This service is designed to run **internally** within your organization's infrastructure:

- **Private Network**: Behind firewall, not exposed to internet
- **Internal Systems Only**: Accessed by authorized internal services
- **Operator Webhooks**: Receives events from payment operators (requires secure channel)
- **No Public API**: Not intended for public consumption

### Not Intended For

- ❌ Public-facing payment forms
- ❌ Direct customer interactions
- ❌ Standalone payment gateway
- ❌ SaaS payment processing
- ❌ Third-party payment handling

---

## Core Components

### 1. Webhook Receiver (`/webhooks/mpesa`)

Receives payment events from operators with cryptographic verification:

```
POST /webhooks/mpesa
{
  "transactionId": "TXN-20250210-001",
  "amount": 500.00,
  "status": "SUCCESS",
  "operatorReference": "MPESA-ABC123",
  "signature": "hmac-sha256-signature"
}
```

**Verification**: HMAC-SHA256 signature ensures operator authenticity.

### 2. State Machine

Tracks payment lifecycle immutably:

```
CREATED → PENDING → SUCCESS → COMPLETED
                  → FAILED  → COMPLETED
                  → EXPIRED → COMPLETED
```

**Immutability**: Once in SUCCESS/FAILED/EXPIRED, state cannot change.

### 3. Audit Logger

Records every event for compliance:

```
Event Types:
- WEBHOOK_RECEIVED: Operator event received
- VALIDATED: Signature and data validated
- STATE_CHANGED: Payment state transitioned
- NOTIFICATION_SENT: External system notified
- ERROR: Processing error occurred
```

### 4. External Notifier

Notifies internal systems of payment outcomes:

```
POST /internal-system/webhooks/payment
{
  "event": "payment.success",
  "transactionId": "TXN-20250210-001",
  "status": "SUCCESS",
  "signature": "hmac-sha256-signature"
}
```

---

## Database Schema

### Payments Table

Stores payment orchestration records (NOT money):

| Field | Purpose |
|-------|---------|
| `transactionId` | Unique payment reference |
| `externalSystemId` | Which internal system initiated this |
| `amount` | Transaction amount (reference only) |
| `status` | Payment state (CREATED, PENDING, SUCCESS, FAILED, EXPIRED, COMPLETED) |
| `operatorReference` | Operator's transaction ID |
| `operatorResponse` | Full operator webhook data |
| `createdAt` | When orchestration started |
| `completedAt` | When payment finalized |

### Transaction Logs Table

Immutable audit trail:

| Field | Purpose |
|-------|---------|
| `paymentId` | Links to payment |
| `eventType` | What happened (WEBHOOK_RECEIVED, VALIDATED, etc.) |
| `details` | Event-specific data |
| `ipAddress` | Source IP of webhook |
| `createdAt` | When event occurred |

### Notifications Table

Tracks external system notifications:

| Field | Purpose |
|-------|---------|
| `paymentId` | Links to payment |
| `externalSystemWebhook` | Where to notify |
| `status` | PENDING, SENT, FAILED |
| `attemptCount` | Retry attempts |
| `nextRetryAt` | When to retry if failed |

---

## Multi-Tenant Support

The service supports multiple internal systems through `externalSystemId`:

```json
{
  "transactionId": "TXN-20250210-001",
  "externalSystemId": "restaurant-pos-001",
  "externalSystemWebhook": "https://internal-restaurant-api/webhooks/payment"
}
```

This allows:
- **Food Delivery System**: Tracks meal orders
- **E-Commerce Platform**: Tracks product purchases
- **Retail POS**: Tracks in-store transactions
- **Subscription Service**: Tracks recurring payments

Each system receives notifications independently.

---

## Legal Compliance

### What Makes This Compliant

1. **No Money Handling**: System never touches funds
2. **Transparent Flow**: Money goes directly operator → merchant
3. **Audit Trail**: Complete immutable logs for 7 years
4. **Non-Repudiation**: Cryptographic signatures prove authenticity
5. **Internal Only**: Not exposed to public or unauthorized parties
6. **State Immutability**: Completed transactions cannot be altered

### Regulatory Alignment

- **Mozambique Payment Regulations**: Compliant with local payment rules
- **PCI DSS**: Not applicable (no card data handled)
- **GDPR**: Minimal personal data, only transaction references
- **SOX/Audit**: Complete audit trail for financial oversight

---

## Security Model

### Signature Verification

All webhooks must be signed with HMAC-SHA256:

```typescript
const secret = process.env.MPESA_WEBHOOK_SECRET;
const signature = HMAC-SHA256(payload, secret);
```

### Idempotency

Duplicate webhooks are handled safely:

```
First Request:  Creates payment, returns 200 OK
Duplicate:      Returns same payment, no state change
```

### Immutable State

Completed payments cannot be modified:

```sql
-- This fails: state is locked
UPDATE payments SET status = 'FAILED' WHERE status = 'SUCCESS';
```

---

## Deployment

### Development

```bash
pnpm dev
```

Starts backend on `http://localhost:3000` with hot reload.

### Production

```bash
pnpm build
pnpm start
```

Or use Docker:

```bash
docker build -t payment-orchestrator .
docker run -e DATABASE_URL=... -e MPESA_WEBHOOK_SECRET=... payment-orchestrator
```

### Internal Network Only

Deploy behind firewall:

```
Internet → [Firewall] → [Internal Network] → Payment Orchestrator
                              ↑
                         Only operators
                         can reach this
```

---

## API Reference

### POST /webhooks/mpesa

Receive payment event from operator.

**Request**:
```json
{
  "transactionId": "TXN-20250210-001",
  "amount": 500.00,
  "currency": "MZN",
  "status": "SUCCESS",
  "operatorReference": "MPESA-ABC123",
  "timestamp": "2025-02-10T14:30:00Z",
  "signature": "hmac-sha256-signature",
  "externalSystemId": "restaurant-001",
  "externalSystemWebhook": "https://internal-api/webhooks/payment"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "transactionId": "TXN-20250210-001",
  "status": "SUCCESS"
}
```

### GET /webhooks/health

Health check endpoint.

**Response** (200 OK):
```json
{
  "status": "ok",
  "timestamp": "2025-02-10T14:30:00Z"
}
```

---

## Monitoring & Audit

### View Payment Status

```sql
SELECT * FROM payments WHERE transactionId = 'TXN-20250210-001';
```

### View Audit Trail

```sql
SELECT * FROM transaction_logs WHERE paymentId = 123 ORDER BY createdAt DESC;
```

### Check Notification Status

```sql
SELECT * FROM notifications WHERE paymentId = 123;
```

### Server Logs

```bash
docker logs payment-orchestrator
```

---

## Troubleshooting

### Signature Validation Failed

**Cause**: Secret mismatch or incorrect signature calculation

**Fix**:
1. Verify `MPESA_WEBHOOK_SECRET` matches operator configuration
2. Ensure payload is JSON stringified in canonical order
3. Check HMAC-SHA256 algorithm

### Payment Stuck in PENDING

**Cause**: Operator webhook not received or notification failed

**Fix**:
1. Check operator webhook logs
2. Verify `externalSystemWebhook` URL is correct
3. Check notification retry logs in database

### External Notification Not Received

**Cause**: Internal system not responding or signature mismatch

**Fix**:
1. Verify internal system webhook URL is accessible
2. Check internal system is returning 200 OK
3. Verify notification signature calculation

---

## Next Steps

1. **Deploy Internally**: Set up in your private network
2. **Configure Operators**: Register webhook URLs with payment operators
3. **Integrate Systems**: Connect your internal systems to receive notifications
4. **Test Thoroughly**: Use test transactions before production
5. **Monitor Continuously**: Watch audit logs and error rates

---

## Support

For issues or questions:

1. Check `API_DOCUMENTATION.md` for endpoint details
2. Review `DEPLOYMENT_GUIDE.md` for setup instructions
3. Consult `LEGAL_COMPLIANCE.md` for regulatory questions
4. Check transaction logs for debugging

---

## Version

- **Service**: Internal Payment Orchestrator v1.0.0
- **Status**: Production Ready
- **Last Updated**: 2025-02-10

---

**Remember**: This is a private, internal-only backend service. It is not a public payment gateway and should never be exposed to the internet or unauthorized parties.
