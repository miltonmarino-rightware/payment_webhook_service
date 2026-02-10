# Payment Webhook Service - API Documentation

## Overview

This is a private backend service for processing payment webhooks from operators like mPesa. The system validates transactions, updates payment states, and notifies external systems without handling money directly.

**Base URL**: `http://localhost:3000`

---

## Authentication

This service uses HMAC-SHA256 signature verification for webhook authentication. All incoming webhooks must include a valid signature.

**Signature Verification**:
- Algorithm: HMAC-SHA256
- Secret: Stored in `MPESA_WEBHOOK_SECRET` environment variable
- Payload: JSON stringified request body (excluding signature field)

---

## Endpoints

### 1. POST /webhooks/mpesa

**Purpose**: Receive payment events from mPesa operator

**Request Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "transactionId": "TXN-20250210-001",
  "amount": 500.00,
  "currency": "MZN",
  "status": "SUCCESS",
  "operatorReference": "MPESA-ABC123XYZ",
  "timestamp": "2025-02-10T14:30:00Z",
  "signature": "hmac-sha256-signature",
  "externalSystemId": "restaurant-001",
  "externalSystemWebhook": "https://restaurant-system.example.com/webhooks/payment"
}
```

**Field Descriptions**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transactionId` | string | Yes | Unique transaction identifier (format: TXN-YYYYMMDD-XXXXX) |
| `amount` | number | Yes | Payment amount (positive number) |
| `currency` | string | No | Currency code (default: MZN) |
| `status` | string | Yes | Payment status (SUCCESS, FAILED, PENDING) |
| `operatorReference` | string | Yes | Operator's transaction reference |
| `timestamp` | string | Yes | ISO 8601 timestamp (must be within 5 minutes of current time) |
| `signature` | string | Yes | HMAC-SHA256 signature for verification |
| `externalSystemId` | string | No | ID of the system that initiated the payment |
| `externalSystemWebhook` | string | No | URL to notify when payment is completed |

**Success Response** (200 OK):
```json
{
  "success": true,
  "transactionId": "TXN-20250210-001",
  "status": "SUCCESS"
}
```

**Error Responses**:

| Status | Response |
|--------|----------|
| 400 | Invalid request format or validation error |
| 401 | Invalid webhook signature |
| 409 | Duplicate transaction (idempotent response) |
| 500 | Internal server error |

**Example Error Response**:
```json
{
  "success": false,
  "error": "Invalid webhook signature"
}
```

**Idempotent Behavior**:
If the same transaction is received multiple times, the service returns a 200 OK response with the current payment status, ensuring idempotency.

---

### 2. GET /webhooks/health

**Purpose**: Health check endpoint

**Response** (200 OK):
```json
{
  "status": "ok",
  "timestamp": "2025-02-10T14:30:00Z"
}
```

---

## Payment State Machine

The payment lifecycle follows these state transitions:

```
CREATED → PENDING → SUCCESS → COMPLETED
                  → FAILED  → COMPLETED
                  → EXPIRED → COMPLETED
```

### State Descriptions

| State | Description |
|-------|-------------|
| CREATED | Payment record created, waiting for operator webhook |
| PENDING | Webhook received from operator, awaiting confirmation |
| SUCCESS | Payment confirmed successful by operator |
| FAILED | Payment rejected by operator |
| EXPIRED | Payment timeout reached |
| COMPLETED | External notification sent |

---

## Webhook Signature Verification

### How to Verify Signatures

**Step 1**: Extract the signature from the request
```javascript
const { signature, ...payloadWithoutSignature } = req.body;
```

**Step 2**: Create canonical string from payload
```javascript
const canonical = JSON.stringify(payloadWithoutSignature, Object.keys(payloadWithoutSignature).sort());
```

**Step 3**: Calculate expected signature
```javascript
const crypto = require('crypto');
const secret = process.env.MPESA_WEBHOOK_SECRET;
const expectedSignature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
```

**Step 4**: Compare signatures
```javascript
const isValid = expectedSignature === signature;
```

---

## External System Notifications

When a payment reaches a terminal state (SUCCESS, FAILED, or EXPIRED), the system sends a notification to the external system webhook URL.

### Notification Payload

```json
{
  "event": "payment.success",
  "paymentId": 123,
  "transactionId": "TXN-20250210-001",
  "status": "SUCCESS",
  "amount": "500.00",
  "currency": "MZN",
  "externalSystemId": "restaurant-001",
  "timestamp": "2025-02-10T14:35:00Z",
  "signature": "hmac-sha256-signature"
}
```

### External System Requirements

The external system must:
1. **Verify Signature**: Validate the signature using the shared secret
2. **Return 200 OK**: Acknowledge receipt with HTTP 200 status
3. **Be Idempotent**: Handle duplicate notifications gracefully
4. **Process Quickly**: Respond within 10 seconds

### Retry Logic

If the external system doesn't respond with 200 OK:
- Attempt 1: Immediate
- Attempt 2: After 5 seconds
- Attempt 3: After 30 seconds
- Attempt 4: After 2 minutes
- Attempt 5: After 10 minutes
- Attempt 6: After 1 hour

After 5 failed attempts, the notification is marked as failed and logged for manual intervention.

---

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| 400 | Invalid request | Check request format and required fields |
| 401 | Invalid signature | Verify signature calculation and secret |
| 409 | Duplicate transaction | Payment already processed (idempotent response) |
| 500 | Internal error | Check server logs |

---

## Database Schema

### Payments Table

Stores all payment transactions:

```sql
CREATE TABLE payments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  transactionId VARCHAR(64) UNIQUE NOT NULL,
  operatorReference VARCHAR(128),
  externalSystemId VARCHAR(128),
  amount DECIMAL(12, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'MZN',
  status ENUM('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'COMPLETED'),
  previousStatus VARCHAR(32),
  operatorResponse JSON,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completedAt TIMESTAMP NULL,
  expiresAt TIMESTAMP NULL,
  ipAddress VARCHAR(45),
  userAgent TEXT
);
```

### Transaction Logs Table

Immutable audit trail of all events:

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
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MPESA_WEBHOOK_SECRET` | Secret for HMAC signature verification | `default-secret` |
| `NOTIFICATION_SECRET` | Secret for external notification signatures | `default-secret` |
| `DATABASE_URL` | MySQL connection string | Required |
| `PORT` | Server port | 3000 |

---

## Example Integration

### 1. Sending a Webhook

```javascript
const crypto = require('crypto');
const axios = require('axios');

const secret = process.env.MPESA_WEBHOOK_SECRET;
const payload = {
  transactionId: 'TXN-20250210-001',
  amount: 500.00,
  currency: 'MZN',
  status: 'SUCCESS',
  operatorReference: 'MPESA-ABC123XYZ',
  timestamp: new Date().toISOString(),
  externalSystemId: 'restaurant-001',
  externalSystemWebhook: 'https://restaurant-system.example.com/webhooks/payment'
};

// Calculate signature
const canonical = JSON.stringify(payload, Object.keys(payload).sort());
const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');

// Send webhook
const response = await axios.post('http://localhost:3000/webhooks/mpesa', {
  ...payload,
  signature
});

console.log(response.data);
```

### 2. Handling External Notifications

```javascript
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const secret = process.env.NOTIFICATION_SECRET;

app.post('/webhooks/payment', (req, res) => {
  const { signature, ...payload } = req.body;

  // Verify signature
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const expectedSignature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');

  if (expectedSignature !== signature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Process payment
  console.log(`Payment ${payload.transactionId} is now ${payload.status}`);

  // Update order status in your system
  updateOrderStatus(payload.externalSystemId, payload.status);

  // Acknowledge receipt
  res.status(200).json({ success: true });
});

app.listen(3001, () => {
  console.log('Webhook receiver listening on port 3001');
});
```

---

## Security Considerations

1. **Always verify signatures** before processing webhooks
2. **Use HTTPS** in production
3. **Implement rate limiting** to prevent abuse
4. **Log all transactions** for audit trail
5. **Never log sensitive data** (full payment details)
6. **Use environment variables** for secrets
7. **Implement IP whitelisting** if possible
8. **Handle errors gracefully** without exposing internal details

---

## Monitoring & Debugging

### Check Payment Status

Query the database:
```sql
SELECT * FROM payments WHERE transactionId = 'TXN-20250210-001';
```

### View Transaction Logs

```sql
SELECT * FROM transaction_logs WHERE paymentId = 123 ORDER BY createdAt DESC;
```

### Check Notification Status

```sql
SELECT * FROM notifications WHERE paymentId = 123;
```

### Server Logs

Check the server console for detailed logs:
```
[Webhook] Processing mPesa webhook...
[Notification] Successfully notified external system for payment 123
```

---

## Compliance & Regulations

- **PCI DSS**: This system is NOT PCI compliant (does not handle card data)
- **Payment Regulations**: Compliant with Mozambique payment regulations
- **Data Retention**: 7-year audit trail maintained
- **Audit Trail**: Complete immutable transaction log
- **Non-Repudiation**: Signature-based verification ensures operator accountability

---

## Support & Troubleshooting

### Common Issues

**Issue**: Invalid signature error
- **Solution**: Verify the shared secret matches between systems
- **Check**: Ensure payload is JSON stringified in canonical order

**Issue**: Duplicate transaction error (409)
- **Solution**: This is expected behavior for idempotent requests
- **Action**: Retry with same transaction ID is safe

**Issue**: External notification not received
- **Solution**: Check notification retry logs in database
- **Check**: Verify external webhook URL is correct and accessible

**Issue**: Payment stuck in PENDING state
- **Solution**: Check transaction logs for validation errors
- **Action**: Manually update status if operator confirms payment

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-02-10 | Initial release |

---

## Contact & Support

For issues or questions, please contact the development team or submit a bug report with:
- Transaction ID
- Timestamp of the issue
- Error message
- Request payload (sanitized)
