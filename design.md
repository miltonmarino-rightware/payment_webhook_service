# Payment Webhook Service - Design Documentation

## Overview

This is a **private backend service** for processing payment webhooks from operators like mPesa. The system validates transactions, updates payment states, and notifies external systems without handling money directly.

---

## Key Principles

1. **No Money Handling**: The system NEVER receives, stores, or moves money. Money flows directly from customer to operator/merchant.
2. **Event Processing Only**: The system processes payment events and manages internal state.
3. **Audit Trail**: Complete logging of all transactions for compliance and debugging.
4. **Internal Only**: This service is used exclusively by internal systems (e.g., restaurant management system).

---

## System Architecture

### Core Components

| Component | Purpose | Technology |
|-----------|---------|-----------|
| **Webhook Endpoint** | Receives payment events from operators | Express.js POST endpoint |
| **Validation Engine** | Validates transaction data and state transitions | Zod + custom validators |
| **State Manager** | Manages payment lifecycle states | Database + business logic |
| **Audit Logger** | Logs all transactions for compliance | Database logging |
| **Notification System** | Sends events to external systems | HTTP webhooks |

---

## Payment State Machine

```
CREATED
  ↓
PENDING (waiting for operator confirmation)
  ↓
SUCCESS (payment confirmed)
  ↓
COMPLETED (notification sent to external system)

OR

PENDING
  ↓
FAILED (payment rejected by operator)
  ↓
COMPLETED (notification sent to external system)

OR

PENDING
  ↓
EXPIRED (timeout reached)
  ↓
COMPLETED (notification sent to external system)
```

### Valid State Transitions

| From | To | Condition |
|------|----|-----------| 
| CREATED | PENDING | Webhook received from operator |
| PENDING | SUCCESS | Operator confirms payment success |
| PENDING | FAILED | Operator confirms payment failure |
| PENDING | EXPIRED | Timeout threshold exceeded |
| SUCCESS | COMPLETED | External notification sent |
| FAILED | COMPLETED | External notification sent |
| EXPIRED | COMPLETED | External notification sent |

---

## Database Schema

### Payments Table

```
id (int, PK)
transactionId (varchar, unique) - Reference from operator
externalSystemId (varchar) - ID of system that initiated payment
amount (decimal) - Payment amount (for reference only, not stored as money)
currency (varchar) - Currency code (e.g., MZN)
status (enum) - CREATED, PENDING, SUCCESS, FAILED, EXPIRED, COMPLETED
previousStatus (varchar) - Previous state for audit trail
operatorReference (varchar) - Operator's transaction ID
operatorResponse (json) - Full response from operator
createdAt (timestamp)
updatedAt (timestamp)
completedAt (timestamp, nullable)
expiresAt (timestamp) - When payment expires if still pending
```

### Transaction Logs Table

```
id (int, PK)
paymentId (int, FK)
eventType (varchar) - CREATED, WEBHOOK_RECEIVED, VALIDATED, STATE_CHANGED, NOTIFICATION_SENT, ERROR
details (json) - Event-specific data
ipAddress (varchar) - Source IP of webhook
userAgent (varchar) - User agent from webhook
createdAt (timestamp)
```

### Notifications Table

```
id (int, PK)
paymentId (int, FK)
externalSystemWebhook (varchar) - URL to notify
status (enum) - PENDING, SENT, FAILED
responseStatus (int, nullable) - HTTP response code
responseBody (text, nullable) - Response from external system
attemptCount (int) - Number of retry attempts
nextRetryAt (timestamp, nullable)
createdAt (timestamp)
updatedAt (timestamp)
```

---

## API Endpoints

### 1. POST /webhooks/mpesa

**Purpose**: Receive payment events from mPesa operator

**Request Body**:
```json
{
  "transactionId": "TXN-20250210-001",
  "amount": 500.00,
  "currency": "MZN",
  "status": "SUCCESS",
  "operatorReference": "MPESA-ABC123XYZ",
  "timestamp": "2025-02-10T14:30:00Z",
  "signature": "hmac-sha256-signature"
}
```

**Validation**:
- ✓ Signature verification (HMAC-SHA256)
- ✓ Transaction ID format validation
- ✓ Amount is positive number
- ✓ Status is valid (SUCCESS, FAILED, PENDING)
- ✓ Timestamp is recent (within 5 minutes)
- ✓ Transaction not already processed

**Response**:
```json
{
  "success": true,
  "transactionId": "TXN-20250210-001",
  "status": "PENDING"
}
```

**Error Responses**:
- 400: Invalid request format
- 401: Invalid signature
- 409: Duplicate transaction
- 500: Internal server error

---

### 2. POST /webhooks/notify-external

**Purpose**: Notify external system of payment state change

**Internal Use Only**: Called by the state manager after successful state transition

**Request Body**:
```json
{
  "paymentId": 123,
  "transactionId": "TXN-20250210-001",
  "externalSystemId": "restaurant-001",
  "status": "SUCCESS",
  "amount": 500.00,
  "currency": "MZN",
  "timestamp": "2025-02-10T14:35:00Z"
}
```

**Retry Logic**:
- Exponential backoff: 5s, 30s, 2m, 10m, 1h
- Maximum 5 attempts
- Failed notifications logged for manual intervention

---

## Validation Rules

### Transaction Reference
- Format: `TXN-YYYYMMDD-XXXXX`
- Must be unique in system
- Cannot be reused

### Amount
- Must be positive number
- Must match previous payment record (if updating)
- Stored as decimal for precision

### State Transitions
- CREATED → PENDING: Always allowed
- PENDING → SUCCESS/FAILED/EXPIRED: Only if previous state is PENDING
- SUCCESS/FAILED/EXPIRED → COMPLETED: Only after notification sent

### Signature Validation
- HMAC-SHA256 using shared secret
- Validates operator authenticity
- Prevents replay attacks

---

## Logging & Audit Trail

Every transaction event is logged with:
- Event type (CREATED, WEBHOOK_RECEIVED, VALIDATED, STATE_CHANGED, etc.)
- Timestamp
- IP address of webhook sender
- Full request/response data
- User agent
- Previous state and new state
- Validation results

**Compliance**: All logs retained for minimum 7 years per payment regulations.

---

## Error Handling

| Error | Handling | Log Level |
|-------|----------|-----------|
| Invalid signature | Reject webhook, log attempt | WARN |
| Duplicate transaction | Idempotent response, no state change | INFO |
| Invalid state transition | Reject, log violation | ERROR |
| External notification failure | Retry with backoff, alert admin | ERROR |
| Database error | Return 500, log stack trace | ERROR |

---

## Security Considerations

1. **Signature Verification**: All webhooks must be signed with HMAC-SHA256
2. **Rate Limiting**: Max 100 requests per minute per operator
3. **IP Whitelisting**: Optional - restrict to known operator IPs
4. **HTTPS Only**: All endpoints require TLS 1.2+
5. **No Sensitive Data**: Never log full payment details, only references
6. **Access Control**: API key required for configuration endpoints

---

## External System Integration

External systems (e.g., restaurant POS) receive notifications via webhook:

**Notification Payload**:
```json
{
  "event": "payment.completed",
  "paymentId": 123,
  "transactionId": "TXN-20250210-001",
  "status": "SUCCESS",
  "amount": 500.00,
  "currency": "MZN",
  "orderReference": "ORDER-001",
  "timestamp": "2025-02-10T14:35:00Z",
  "signature": "hmac-sha256-signature"
}
```

External system must:
- Verify signature using shared secret
- Update order status based on payment status
- Return 200 OK to acknowledge receipt
- Implement retry-safe logic (idempotent operations)

---

## Development Roadmap

### Phase 1: Core Infrastructure
- [ ] Database schema and migrations
- [ ] Express server setup with middleware
- [ ] Webhook endpoint implementation
- [ ] Signature validation

### Phase 2: State Management
- [ ] Payment state machine logic
- [ ] State transition validation
- [ ] Audit logging system

### Phase 3: Notifications
- [ ] External webhook notification system
- [ ] Retry logic with exponential backoff
- [ ] Notification status tracking

### Phase 4: Testing & Deployment
- [ ] Unit tests for validators
- [ ] Integration tests for state transitions
- [ ] End-to-end webhook tests
- [ ] Documentation and deployment guide

---

## Technology Stack

- **Runtime**: Node.js 22+
- **Framework**: Express.js
- **Database**: MySQL/TiDB (via Drizzle ORM)
- **Validation**: Zod
- **Logging**: Console + Database
- **Testing**: Vitest
- **Language**: TypeScript

---

## Compliance & Regulations

- **PCI DSS**: System is NOT PCI compliant (doesn't handle card data)
- **Payment Regulations**: Compliant with Mozambique payment regulations
- **Data Retention**: 7-year audit trail
- **Audit Trail**: Complete immutable transaction log
- **Non-Repudiation**: Signature-based verification ensures operator accountability

---

## Monitoring & Alerts

Key metrics to monitor:
- Webhook success rate
- Average response time
- Failed state transitions
- External notification failures
- Database connection health

Alerts triggered for:
- Signature validation failures
- Duplicate transaction attempts
- Invalid state transitions
- External notification failures after 5 retries
- Database connectivity issues
