# Legal Compliance & Regulatory Framework

## Service Classification

**Internal Payment Orchestrator** is classified as:

- **NOT** a payment processor
- **NOT** a payment gateway
- **NOT** a money transmitter
- **NOT** a financial institution
- **IS** an internal transaction coordinator

This classification is critical for regulatory compliance.

---

## Legal Restrictions

### What This Service CANNOT Do

The system is **explicitly prohibited** from:

1. **Receiving Money**
   - Cannot accept funds from customers
   - Cannot hold customer deposits
   - Cannot act as escrow agent
   - Cannot collect payments directly

2. **Storing Money**
   - Cannot maintain customer balances
   - Cannot hold wallets or accounts
   - Cannot retain transaction funds
   - Cannot act as custodian

3. **Moving Money**
   - Cannot transfer funds between accounts
   - Cannot initiate bank transfers
   - Cannot process refunds directly
   - Cannot move customer money

4. **Financial Services**
   - Cannot offer credit or loans
   - Cannot exchange currencies
   - Cannot provide investment services
   - Cannot offer payment plans

### What This Service CAN Do

The system is **explicitly permitted** to:

1. **Orchestrate Transactions**
   - Coordinate payment intentions
   - Track payment events
   - Route payment notifications

2. **Maintain Audit Trail**
   - Log all transactions
   - Record state changes
   - Document operator communications

3. **Notify Internal Systems**
   - Send payment confirmations
   - Relay operator responses
   - Trigger internal workflows

4. **Verify Authenticity**
   - Validate operator signatures
   - Confirm payment status
   - Prevent fraud/replay attacks

---

## Money Flow Architecture

### Correct Flow (Compliant)

```
Customer
    ↓
    └─→ Operator/Merchant (mPesa, Stripe, etc.)
            ↓
            └─→ Merchant receives money
                    ↓
                    └─→ Operator notifies Orchestrator
                            ↓
                            └─→ Orchestrator notifies Internal System
                                    ↓
                                    └─→ Internal System updates records
```

**Key Point**: Money never touches the Orchestrator. It flows directly from customer to operator to merchant.

### Incorrect Flow (Non-Compliant)

```
❌ Customer → Orchestrator → Operator (WRONG: Orchestrator handles money)
❌ Customer → Operator → Orchestrator → Merchant (WRONG: Orchestrator holds funds)
❌ Orchestrator → Bank (WRONG: Orchestrator initiates transfers)
```

---

## Regulatory Compliance

### Mozambique Payment Regulations

**Compliant Because**:
- No direct money handling
- No customer account maintenance
- No fund movement
- Complete audit trail
- Operator handles all financial aspects

**Required Documentation**:
- Transaction logs (7-year retention)
- Operator communications
- State change records
- Error logs

### PCI DSS (Payment Card Industry Data Security Standard)

**NOT APPLICABLE** because:
- System does not store card data
- System does not process card details
- System does not transmit card information
- System only handles transaction references

**If Card Data Appears**:
- Log it as security incident
- Do NOT store or process
- Immediately notify operator
- Escalate to security team

### GDPR (General Data Protection Regulation)

**Minimal Personal Data** because:
- Only stores transaction references
- No customer names or addresses
- No payment method details
- No location data

**Data Retention**:
- 7 years for audit compliance
- After 7 years, delete logs
- No indefinite retention

### SOX (Sarbanes-Oxley)

**Audit Trail Requirements**:
- Complete transaction logging ✓
- Immutable state records ✓
- Chronological event tracking ✓
- Operator communication logs ✓
- Error documentation ✓

---

## Immutability Requirements

### State Immutability

Once a payment reaches a terminal state, it **cannot be modified**:

```sql
-- Terminal States (Cannot Change)
SUCCESS   → Locked
FAILED    → Locked
EXPIRED   → Locked
COMPLETED → Locked

-- Non-Terminal States (Can Change)
CREATED   → PENDING
PENDING   → SUCCESS/FAILED/EXPIRED
```

### Audit Trail Immutability

Transaction logs are **append-only**:

```sql
-- Allowed
INSERT INTO transaction_logs (...)  -- ✓ Add new event
SELECT * FROM transaction_logs      -- ✓ Read history

-- NOT Allowed
UPDATE transaction_logs ...         -- ✗ Cannot modify events
DELETE FROM transaction_logs ...    -- ✗ Cannot delete events
```

### Database Constraints

```sql
-- Enforce immutability
ALTER TABLE payments ADD CONSTRAINT chk_status_immutable
CHECK (
  CASE
    WHEN status IN ('SUCCESS', 'FAILED', 'EXPIRED', 'COMPLETED') THEN 1
    ELSE 0
  END = 1
);
```

---

## Audit Trail Requirements

### Mandatory Logging

Every transaction must log:

| Field | Purpose | Retention |
|-------|---------|-----------|
| `transactionId` | Unique identifier | 7 years |
| `eventType` | What happened | 7 years |
| `timestamp` | When it happened | 7 years |
| `ipAddress` | Source of event | 7 years |
| `previousState` | State before change | 7 years |
| `newState` | State after change | 7 years |
| `operatorResponse` | Operator data | 7 years |
| `errorDetails` | If error occurred | 7 years |

### Event Types to Log

```
WEBHOOK_RECEIVED        - Operator webhook received
SIGNATURE_VALIDATED     - Signature verification passed
DUPLICATE_DETECTED      - Duplicate transaction detected
STATE_CHANGED           - Payment state transitioned
NOTIFICATION_SENT       - External system notified
NOTIFICATION_FAILED     - External notification failed
ERROR_OCCURRED          - Processing error
AUDIT_QUERY             - Audit log accessed
```

### Audit Query Example

```sql
-- Complete audit trail for transaction
SELECT 
  tl.eventType,
  tl.timestamp,
  tl.previousState,
  tl.newState,
  tl.details,
  tl.ipAddress
FROM transaction_logs tl
WHERE tl.paymentId = 123
ORDER BY tl.timestamp ASC;
```

---

## Non-Repudiation

### Signature Verification

All webhooks must be cryptographically signed:

**Operator → Orchestrator**:
```
Signature = HMAC-SHA256(payload, MPESA_WEBHOOK_SECRET)
```

**Orchestrator → Internal System**:
```
Signature = HMAC-SHA256(payload, NOTIFICATION_SECRET)
```

### Benefits

1. **Authenticity**: Proves message came from claimed source
2. **Integrity**: Proves message wasn't modified
3. **Non-Repudiation**: Operator cannot deny sending webhook
4. **Compliance**: Satisfies audit requirements

### Verification Code

```typescript
function verifySignature(payload, signature, secret) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const expectedSignature = HMAC-SHA256(canonical, secret);
  return expectedSignature === signature;
}
```

---

## Multi-Tenant Isolation

### System Separation

Each internal system is isolated:

```sql
-- System A can only see its payments
SELECT * FROM payments WHERE externalSystemId = 'system-a';

-- System B cannot see System A's data
SELECT * FROM payments WHERE externalSystemId = 'system-b';
```

### Notification Isolation

Each system receives only its notifications:

```json
{
  "externalSystemId": "restaurant-001",
  "externalSystemWebhook": "https://restaurant-api/webhooks/payment",
  "transactionId": "TXN-20250210-001"
}
```

### Audit Trail Isolation

Logs include system context:

```sql
SELECT * FROM transaction_logs 
WHERE paymentId IN (
  SELECT id FROM payments 
  WHERE externalSystemId = 'restaurant-001'
);
```

---

## Error Handling & Compliance

### Error Logging

All errors must be logged with context:

```typescript
try {
  processWebhook(payload);
} catch (error) {
  logTransaction({
    eventType: 'ERROR_OCCURRED',
    details: {
      errorMessage: error.message,
      errorStack: error.stack,
      payload: payload, // Full context
      timestamp: new Date()
    }
  });
}
```

### No Data Loss

Errors must not result in lost data:

- ✓ Retry failed notifications
- ✓ Log all errors
- ✓ Maintain state consistency
- ✓ Alert on critical failures

### Error Notification

Critical errors must trigger alerts:

```typescript
if (error.severity === 'CRITICAL') {
  notifyAdministrator({
    subject: 'Payment Orchestrator Error',
    message: error.message,
    transactionId: payment.transactionId
  });
}
```

---

## Compliance Checklist

### Before Deployment

- [ ] All secrets stored in environment variables (not in code)
- [ ] Database encryption enabled
- [ ] HTTPS/TLS configured for all endpoints
- [ ] Firewall rules restrict to internal network only
- [ ] Audit logging enabled
- [ ] Backup strategy implemented
- [ ] Disaster recovery plan documented
- [ ] Access controls configured

### During Operation

- [ ] Monitor error logs daily
- [ ] Verify audit trail integrity weekly
- [ ] Test backup restoration monthly
- [ ] Review access logs quarterly
- [ ] Audit compliance annually

### Documentation

- [ ] Keep this compliance document updated
- [ ] Document all configuration changes
- [ ] Maintain operator communication logs
- [ ] Record all system updates
- [ ] Document incident responses

---

## Incident Response

### Payment Processing Error

1. **Immediate**: Log error with full context
2. **Within 1 Hour**: Notify system administrator
3. **Within 24 Hours**: Investigate root cause
4. **Within 48 Hours**: Implement fix
5. **Document**: Record incident and resolution

### Signature Verification Failure

1. **Immediate**: Reject webhook (return 401)
2. **Log**: Record failed verification attempt
3. **Alert**: Notify security team
4. **Investigate**: Check for tampering or misconfiguration
5. **Document**: Record security incident

### External Notification Failure

1. **Immediate**: Schedule retry with backoff
2. **Log**: Record failure attempt
3. **After 5 Attempts**: Mark as failed
4. **Alert**: Notify system administrator
5. **Document**: Record notification failure

---

## Regulatory Contacts

### Mozambique

- **Payment Authority**: Banco de Moçambique (BM)
- **Financial Regulator**: Autoridade de Regulação e Supervisão de Seguros (ARIS)
- **Data Protection**: Autoridade de Proteção de Dados Pessoais (APDP)

### International

- **GDPR**: European Data Protection Board
- **PCI DSS**: PCI Security Standards Council
- **SOX**: SEC (Securities and Exchange Commission)

---

## Disclaimer

This service is provided as-is for internal use only. The organization using this service is responsible for:

1. Ensuring compliance with all applicable laws and regulations
2. Maintaining proper audit trails and documentation
3. Protecting the service from unauthorized access
4. Monitoring and maintaining the service
5. Obtaining legal review before deployment

**This service does NOT provide legal, financial, or regulatory advice.**

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-02-10 | Initial compliance framework |

---

## Last Updated

**2025-02-10** - Initial Legal Compliance Document

For questions about compliance, consult with your legal and regulatory teams before deployment.
