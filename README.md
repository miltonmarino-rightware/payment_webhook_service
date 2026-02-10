# Internal Payment Orchestrator

**⚠️ PRIVATE BACKEND SERVICE - NOT FOR PUBLIC USE**

A private, internal-only backend service for orchestrating payment transactions within your organization. This service coordinates payment events between your internal systems and external payment operators without ever handling money directly.

---

## 🚨 Critical Legal Notice

### What This Service Does NOT Do

- ❌ Does NOT receive money from customers
- ❌ Does NOT store customer funds or balances
- ❌ Does NOT move or transfer money
- ❌ Does NOT operate as a payment processor or gateway
- ❌ Does NOT provide financial services

### What This Service ONLY Does

- ✓ Orchestrates payment intentions via webhooks
- ✓ Tracks payment confirmation events
- ✓ Maintains immutable audit trails
- ✓ Notifies internal systems of payment outcomes
- ✓ Routes payment events between operators and internal systems

**Money flows directly from customer → operator/merchant. This service never touches funds.**

---

## 📋 Service Overview

### Architecture

```
Your Internal System          Internal Payment              Payment Operator
(Restaurant POS, etc.)        Orchestrator                  (mPesa, Stripe)
        |                            |                            |
        |--1. Initiate Payment----->|                            |
        |                            |--2. Forward Event-------->|
        |                            |                            |
        |                            |<--3. Webhook Event--------|
        |<--4. Notify Result---------|                            |
        |                            |
```

### Key Features

- **Backend-Only**: No user interface, no direct user interaction
- **Event-Driven**: Operates on webhook events from payment operators
- **Immutable State**: Completed transactions cannot be modified
- **Multi-Tenant**: Supports multiple internal systems simultaneously
- **Audit-First**: Every event logged for compliance
- **Idempotent**: Safe to retry failed requests
- **Cryptographically Secure**: HMAC-SHA256 signature verification

---

## 🔒 Deployment Model

### Intended Use

- ✓ Deploy behind firewall in private network
- ✓ Access by authorized internal systems only
- ✓ Receive webhooks from payment operators (secure channel)
- ✓ Send notifications to internal systems

### NOT Intended For

- ❌ Public-facing payment forms
- ❌ Direct customer interactions
- ❌ Standalone payment gateway
- ❌ SaaS payment processing
- ❌ Third-party payment handling

---

## 📦 What's Included

### Core Components

| Component | Purpose |
|-----------|---------|
| **Webhook Receiver** | Receives payment events from operators with HMAC-SHA256 verification |
| **State Machine** | Tracks payment lifecycle immutably (CREATED → PENDING → SUCCESS/FAILED/EXPIRED → COMPLETED) |
| **Audit Logger** | Records every event for compliance and debugging |
| **External Notifier** | Notifies internal systems with exponential backoff retry logic |
| **Database Layer** | Stores immutable transaction records and audit trails |

### Documentation

| Document | Purpose |
|----------|---------|
| `README_BACKEND_SERVICE.md` | Detailed service overview and architecture |
| `API_DOCUMENTATION.md` | Complete API endpoint specifications and examples |
| `LEGAL_COMPLIANCE.md` | Regulatory framework and compliance requirements |
| `INTERNAL_DEPLOYMENT_ONLY.md` | Deployment guide for private networks |
| `DEPLOYMENT_GUIDE.md` | Technical deployment instructions (Docker, Kubernetes, Nginx) |
| `design.md` | System design and technical architecture |

### Code

| File | Purpose |
|------|---------|
| `server/webhooks.ts` | Webhook endpoint implementation |
| `server/validators.ts` | Validation logic (signatures, state transitions) |
| `server/notifications.ts` | External system notification system |
| `server/db.ts` | Database operations and queries |
| `drizzle/schema.ts` | Database schema (payments, logs, notifications) |
| `tests/webhooks.test.ts` | Comprehensive test suite (20 tests, all passing) |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 22+
- MySQL 8.0+ or TiDB
- Private network environment

### Installation

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
pnpm db:push

# Start development server
pnpm dev

# Or build for production
pnpm build
pnpm start
```

### Verify Installation

```bash
# Check TypeScript compilation
pnpm check

# Run tests
pnpm test

# Check health endpoint
curl http://localhost:3000/webhooks/health
```

---

## 📡 API Endpoints

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

## 💾 Database Schema

### Payments Table

Stores payment orchestration records (NOT money):

```sql
CREATE TABLE payments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  transactionId VARCHAR(64) UNIQUE NOT NULL,
  externalSystemId VARCHAR(128) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'MZN',
  status ENUM('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'COMPLETED'),
  operatorReference VARCHAR(128),
  operatorResponse JSON,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completedAt TIMESTAMP NULL
);
```

### Transaction Logs Table

Immutable audit trail:

```sql
CREATE TABLE transaction_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  paymentId INT NOT NULL,
  eventType VARCHAR(32) NOT NULL,
  details JSON,
  ipAddress VARCHAR(45),
  userAgent TEXT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Notifications Table

Tracks external system notifications:

```sql
CREATE TABLE notifications (
  id INT PRIMARY KEY AUTO_INCREMENT,
  paymentId INT NOT NULL,
  externalSystemWebhook VARCHAR(512) NOT NULL,
  status ENUM('PENDING', 'SENT', 'FAILED') DEFAULT 'PENDING',
  responseStatus INT,
  responseBody TEXT,
  attemptCount INT DEFAULT 0,
  nextRetryAt TIMESTAMP NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🔐 Security

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

## 📊 Monitoring

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

---

## 🧪 Testing

### Run Tests

```bash
pnpm test
```

### Test Coverage

- 20 comprehensive unit tests
- Signature verification tests
- State transition validation tests
- Timestamp validation tests
- Transaction ID format validation tests
- Retry logic tests

---

## 📚 Documentation

### For Developers

1. **Start here**: `README_BACKEND_SERVICE.md` - Service overview
2. **API details**: `API_DOCUMENTATION.md` - Endpoint specifications
3. **Architecture**: `design.md` - Technical design

### For Operations

1. **Deployment**: `INTERNAL_DEPLOYMENT_ONLY.md` - Private network deployment
2. **Setup guide**: `DEPLOYMENT_GUIDE.md` - Docker, Kubernetes, Nginx

### For Compliance

1. **Legal framework**: `LEGAL_COMPLIANCE.md` - Regulatory requirements
2. **Audit trail**: Database logs and transaction records

---

## 🚨 Important Reminders

### Network Security

- **MUST** deploy behind firewall
- **MUST** restrict to internal network only
- **MUST NOT** expose to internet
- **MUST** use HTTPS with valid certificates
- **MUST** implement IP whitelisting

### Operational Security

- **MUST** rotate secrets regularly
- **MUST** monitor error logs daily
- **MUST** backup database daily
- **MUST** test disaster recovery monthly
- **MUST** maintain audit trail for 7 years

### Legal Compliance

- **MUST** obtain legal review before deployment
- **MUST** comply with local payment regulations
- **MUST** maintain immutable audit trails
- **MUST** verify operator authenticity
- **MUST** document all configuration changes

---

## 🆘 Troubleshooting

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

## 📞 Support

For issues or questions:

1. Check `API_DOCUMENTATION.md` for endpoint details
2. Review `INTERNAL_DEPLOYMENT_ONLY.md` for setup
3. Consult `LEGAL_COMPLIANCE.md` for regulatory questions
4. Check transaction logs for debugging

---

## 📝 Version

- **Service**: Internal Payment Orchestrator v1.0.0
- **Status**: Production Ready
- **Last Updated**: 2025-02-10

---

## ⚖️ Legal Disclaimer

This service is provided as-is for internal use only. The organization using this service is responsible for:

1. Ensuring compliance with all applicable laws and regulations
2. Maintaining proper audit trails and documentation
3. Protecting the service from unauthorized access
4. Monitoring and maintaining the service
5. Obtaining legal review before deployment

**This service does NOT provide legal, financial, or regulatory advice.**

---

**Remember**: This is a private, internal-only backend service. It is not a public payment gateway and should never be exposed to the internet or unauthorized parties.

For deployment instructions, see `INTERNAL_DEPLOYMENT_ONLY.md`.
