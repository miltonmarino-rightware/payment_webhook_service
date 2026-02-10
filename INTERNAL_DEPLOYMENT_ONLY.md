# ⚠️ INTERNAL DEPLOYMENT ONLY

**THIS SERVICE MUST ONLY BE DEPLOYED WITHIN YOUR PRIVATE NETWORK**

---

## Critical Security Requirements

### Network Isolation

```
❌ DO NOT expose to the internet
❌ DO NOT make publicly accessible
❌ DO NOT use public DNS
❌ DO NOT allow external connections

✓ DO deploy behind firewall
✓ DO use private network only
✓ DO restrict to internal IPs
✓ DO use VPN for remote access
```

### Firewall Rules

**Incoming Traffic - ONLY from**:
- Payment operators (mPesa, Stripe, etc.) via secure channel
- Internal systems within your network
- Administrators via VPN

**Outgoing Traffic - ONLY to**:
- Payment operators (webhooks)
- Internal systems (notifications)
- Database server

**Example iptables rules**:

```bash
# Allow operator webhooks (example: mPesa)
iptables -A INPUT -p tcp --dport 3000 -s MPESA_IP -j ACCEPT

# Allow internal systems
iptables -A INPUT -p tcp --dport 3000 -s 10.0.0.0/8 -j ACCEPT

# Allow VPN access
iptables -A INPUT -p tcp --dport 3000 -s VPN_SUBNET -j ACCEPT

# Deny all other traffic
iptables -A INPUT -p tcp --dport 3000 -j DROP
```

---

## Deployment Checklist

### Before Deployment

- [ ] Service deployed in private network ONLY
- [ ] Firewall configured to restrict access
- [ ] HTTPS/TLS enabled with valid certificate
- [ ] All secrets in environment variables (never in code)
- [ ] Database encrypted and backed up
- [ ] Audit logging enabled
- [ ] Monitoring and alerting configured
- [ ] Disaster recovery plan documented
- [ ] Legal review completed
- [ ] Compliance team approved

### Network Configuration

- [ ] Private IP address assigned (not public)
- [ ] DNS entry in internal DNS only (not public)
- [ ] No port forwarding from internet
- [ ] VPN required for remote access
- [ ] Firewall rules restrict to operators and internal systems
- [ ] Rate limiting configured
- [ ] DDoS protection enabled (if applicable)

### Access Control

- [ ] Only authorized administrators can access
- [ ] SSH key-based authentication required
- [ ] Sudo access restricted
- [ ] Database credentials not shared
- [ ] Webhook secrets not logged
- [ ] API keys rotated regularly
- [ ] Access logs monitored

### Monitoring

- [ ] Error logs monitored 24/7
- [ ] Performance metrics tracked
- [ ] Database health checked hourly
- [ ] Backup integrity verified weekly
- [ ] Security logs reviewed daily
- [ ] Alerts configured for critical issues
- [ ] Incident response plan documented

---

## Operator Webhook Configuration

### mPesa Webhook Setup

**1. Register Webhook URL**

```
Internal URL: https://internal-api.company.local:3000/webhooks/mpesa
```

**Requirements**:
- Must be accessible from mPesa servers
- Must use HTTPS with valid certificate
- Must respond within 30 seconds
- Must return 200 OK on success

**2. Configure Signature Secret**

```bash
# Set in environment
export MPESA_WEBHOOK_SECRET="your-secret-from-mpesa"
```

**3. Test Webhook**

```bash
curl -X POST https://internal-api.company.local:3000/webhooks/mpesa \
  -H "Content-Type: application/json" \
  -d '{
    "transactionId": "TXN-20250210-TEST",
    "amount": 100.00,
    "status": "SUCCESS",
    "operatorReference": "MPESA-TEST123",
    "timestamp": "2025-02-10T14:30:00Z",
    "signature": "test-signature"
  }'
```

### Operator Network Requirements

**Operator must be able to reach**:
- Your webhook URL (HTTPS)
- Your IP address/domain
- Your port (default: 3000)

**Your network must allow**:
- Inbound HTTPS from operator
- Outbound HTTPS to operator (for status checks)

---

## Internal System Integration

### Restaurant POS Integration

**1. Configure Notification Webhook**

```json
{
  "externalSystemId": "restaurant-pos-001",
  "externalSystemWebhook": "https://internal-restaurant-api:8080/webhooks/payment"
}
```

**2. Implement Webhook Handler**

```javascript
app.post('/webhooks/payment', (req, res) => {
  const { signature, ...payload } = req.body;
  
  // Verify signature
  const expectedSignature = HMAC-SHA256(payload, NOTIFICATION_SECRET);
  if (expectedSignature !== signature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Process payment
  updateOrderStatus(payload.transactionId, payload.status);
  
  // Acknowledge receipt
  res.status(200).json({ success: true });
});
```

**3. Test Integration**

```bash
# Send test notification
curl -X POST https://internal-restaurant-api:8080/webhooks/payment \
  -H "Content-Type: application/json" \
  -d '{
    "event": "payment.success",
    "transactionId": "TXN-20250210-001",
    "status": "SUCCESS",
    "signature": "test-signature"
  }'
```

---

## Docker Deployment (Internal Only)

### Dockerfile

```dockerfile
FROM node:22-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Security: Run as non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000

CMD ["pnpm", "start"]
```

### Docker Compose (Internal Network Only)

```yaml
version: '3.8'

services:
  db:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: payment_orchestrator
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - db_data:/var/lib/mysql
    networks:
      - internal
    restart: unless-stopped
    # Security: No port exposure
    expose:
      - "3306"

  api:
    build: .
    environment:
      DATABASE_URL: mysql://${DB_USER}:${DB_PASSWORD}@db:3306/payment_orchestrator
      MPESA_WEBHOOK_SECRET: ${MPESA_WEBHOOK_SECRET}
      NOTIFICATION_SECRET: ${NOTIFICATION_SECRET}
      NODE_ENV: production
    networks:
      - internal
    depends_on:
      - db
    restart: unless-stopped
    # Security: No port exposure to host
    expose:
      - "3000"

networks:
  internal:
    driver: bridge
    # Security: Internal network only
    driver_opts:
      com.docker.network.bridge.enable_icc: "true"

volumes:
  db_data:
```

### Deploy

```bash
# Create .env file with secrets
cat > .env << EOF
DB_ROOT_PASSWORD=secure-root-password
DB_USER=payment_user
DB_PASSWORD=secure-user-password
MPESA_WEBHOOK_SECRET=your-mpesa-secret
NOTIFICATION_SECRET=your-notification-secret
EOF

# Start services
docker-compose up -d

# Verify running
docker-compose ps
docker-compose logs api
```

---

## Nginx Reverse Proxy (Internal Only)

### Configuration

```nginx
# Internal network only - no internet exposure

upstream payment_orchestrator {
    server api:3000;
}

server {
    listen 443 ssl http2;
    server_name internal-payment-api.company.local;

    # SSL certificates (internal CA)
    ssl_certificate /etc/ssl/certs/internal-ca.crt;
    ssl_certificate_key /etc/ssl/private/internal-ca.key;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    # Access control - internal IPs only
    allow 10.0.0.0/8;           # Internal network
    allow 192.168.0.0/16;       # Internal network
    deny all;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=webhook_limit:10m rate=100r/m;

    location /webhooks/ {
        limit_req zone=webhook_limit burst=20 nodelay;
        proxy_pass http://payment_orchestrator;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }

    location /api/ {
        proxy_pass http://payment_orchestrator;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check (internal only)
    location /health {
        access_log off;
        proxy_pass http://payment_orchestrator/webhooks/health;
    }
}

# HTTP redirect (internal only)
server {
    listen 80;
    server_name internal-payment-api.company.local;
    return 301 https://$server_name$request_uri;
}
```

---

## Monitoring & Alerts

### Critical Alerts

Configure alerts for:

1. **Webhook Failures**
   - Signature validation failures
   - Processing errors
   - Database connection issues

2. **Notification Failures**
   - External system unreachable
   - Notification retry exhausted
   - Timeout errors

3. **Security Issues**
   - Multiple failed signature verifications
   - Unusual traffic patterns
   - Unauthorized access attempts

4. **System Health**
   - Database connection pool exhausted
   - Disk space low
   - Memory usage high
   - CPU usage high

### Example Alert Configuration

```bash
# Check webhook errors
SELECT COUNT(*) as error_count
FROM transaction_logs
WHERE eventType = 'WEBHOOK_ERROR'
AND createdAt > DATE_SUB(NOW(), INTERVAL 1 HOUR);

# Alert if > 10 errors in last hour
if [ $error_count -gt 10 ]; then
  send_alert "Payment Orchestrator: High error rate"
fi
```

---

## Backup & Recovery

### Daily Backup

```bash
#!/bin/bash
# backup.sh - Run daily via cron

BACKUP_DIR="/backups/payment-orchestrator"
DATE=$(date +%Y%m%d_%H%M%S)

# Backup database
mysqldump -u $DB_USER -p$DB_PASSWORD payment_orchestrator | \
  gzip > $BACKUP_DIR/payment_orchestrator_$DATE.sql.gz

# Verify backup
if [ -f $BACKUP_DIR/payment_orchestrator_$DATE.sql.gz ]; then
  echo "Backup successful: payment_orchestrator_$DATE.sql.gz"
else
  send_alert "Payment Orchestrator backup FAILED"
fi

# Keep only last 30 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete
```

### Cron Job

```bash
# Add to crontab
0 2 * * * /scripts/backup.sh
```

### Recovery Procedure

```bash
# Restore from backup
gunzip < /backups/payment-orchestrator/payment_orchestrator_20250210_020000.sql.gz | \
  mysql -u $DB_USER -p$DB_PASSWORD payment_orchestrator

# Verify restoration
mysql -u $DB_USER -p$DB_PASSWORD -e "SELECT COUNT(*) FROM payments;"
```

---

## Compliance Verification

### Before Going Live

- [ ] Legal review completed
- [ ] Compliance team approved
- [ ] Security audit passed
- [ ] Penetration testing completed
- [ ] Audit trail tested
- [ ] Backup/recovery tested
- [ ] Disaster recovery plan tested
- [ ] Documentation complete

### Ongoing Compliance

- [ ] Monthly security review
- [ ] Quarterly compliance audit
- [ ] Annual penetration testing
- [ ] Continuous monitoring
- [ ] Incident response testing

---

## Support & Escalation

### Critical Issues

1. **Immediate**: Stop accepting new transactions
2. **Within 1 Hour**: Notify security team
3. **Within 4 Hours**: Implement fix
4. **Within 24 Hours**: Root cause analysis
5. **Within 48 Hours**: Corrective action plan

### Contact Information

- **Security Team**: security@company.local
- **Database Team**: database@company.local
- **Operations Team**: ops@company.local
- **Legal Team**: legal@company.local

---

## Remember

**This service is INTERNAL ONLY. It must never be exposed to the internet or unauthorized parties.**

- ✓ Deploy behind firewall
- ✓ Restrict network access
- ✓ Use strong authentication
- ✓ Monitor continuously
- ✓ Maintain audit trails
- ✓ Test regularly
- ✓ Keep documentation updated

**Failure to follow these guidelines may result in security breaches, compliance violations, and legal liability.**

---

**Last Updated**: 2025-02-10
