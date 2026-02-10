# Payment Webhook Service - Deployment Guide

## Prerequisites

- Node.js 22+ with npm/pnpm
- MySQL 8.0+ or TiDB
- Environment with internet access for webhook callbacks
- HTTPS certificate (for production)

---

## Environment Setup

### 1. Create `.env` File

Create a `.env` file in the project root with the following variables:

```bash
# Database Configuration
DATABASE_URL=mysql://user:password@localhost:3306/payment_service

# Server Configuration
PORT=3000
NODE_ENV=production

# Webhook Secrets
MPESA_WEBHOOK_SECRET=your-mpesa-webhook-secret-key-here
NOTIFICATION_SECRET=your-notification-secret-key-here

# OAuth Configuration (if using user auth)
VITE_APP_ID=your-app-id
OAUTH_SERVER_URL=https://oauth.example.com
VITE_OAUTH_PORTAL_URL=https://login.example.com
OWNER_OPEN_ID=your-owner-id
OWNER_NAME=Your Name
```

### 2. Database Setup

#### Option A: Using MySQL

```bash
# Create database
mysql -u root -p -e "CREATE DATABASE payment_service CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Create user
mysql -u root -p -e "CREATE USER 'payment_user'@'localhost' IDENTIFIED BY 'secure-password';"
mysql -u root -p -e "GRANT ALL PRIVILEGES ON payment_service.* TO 'payment_user'@'localhost';"
mysql -u root -p -e "FLUSH PRIVILEGES;"
```

#### Option B: Using TiDB Cloud

1. Create a TiDB cluster on TiDB Cloud
2. Get the connection string from the dashboard
3. Update `DATABASE_URL` in `.env`

### 3. Run Database Migrations

```bash
pnpm db:push
```

This will:
- Generate migration files
- Apply migrations to the database
- Create all required tables

---

## Installation

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Build the Project

```bash
pnpm build
```

### 3. Verify TypeScript

```bash
pnpm check
```

### 4. Run Tests

```bash
pnpm test
```

---

## Running the Service

### Development Mode

```bash
pnpm dev
```

This starts both the Metro bundler and the backend server with hot reload.

### Production Mode

```bash
# Build the server
pnpm build

# Start the server
pnpm start
```

The server will start on the port specified in `.env` (default: 3000).

---

## Docker Deployment

### Create Dockerfile

```dockerfile
FROM node:22-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the server
RUN pnpm build

# Expose port
EXPOSE 3000

# Start the server
CMD ["pnpm", "start"]
```

### Build and Run Docker Image

```bash
# Build image
docker build -t payment-webhook-service:1.0.0 .

# Run container
docker run -d \
  --name payment-webhook \
  -p 3000:3000 \
  -e DATABASE_URL="mysql://user:password@db:3306/payment_service" \
  -e MPESA_WEBHOOK_SECRET="your-secret" \
  -e NOTIFICATION_SECRET="your-secret" \
  payment-webhook-service:1.0.0
```

### Docker Compose

```yaml
version: '3.8'

services:
  db:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: payment_service
      MYSQL_ROOT_PASSWORD: root-password
      MYSQL_USER: payment_user
      MYSQL_PASSWORD: user-password
    ports:
      - "3306:3306"
    volumes:
      - db_data:/var/lib/mysql

  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: mysql://payment_user:user-password@db:3306/payment_service
      MPESA_WEBHOOK_SECRET: ${MPESA_WEBHOOK_SECRET}
      NOTIFICATION_SECRET: ${NOTIFICATION_SECRET}
      NODE_ENV: production
    depends_on:
      - db
    restart: unless-stopped

volumes:
  db_data:
```

Run with: `docker-compose up -d`

---

## Kubernetes Deployment

### Create ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: payment-webhook-config
data:
  NODE_ENV: "production"
  PORT: "3000"
```

### Create Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: payment-webhook-secrets
type: Opaque
stringData:
  DATABASE_URL: "mysql://user:password@db:3306/payment_service"
  MPESA_WEBHOOK_SECRET: "your-secret"
  NOTIFICATION_SECRET: "your-secret"
```

### Create Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-webhook
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-webhook
  template:
    metadata:
      labels:
        app: payment-webhook
    spec:
      containers:
      - name: api
        image: payment-webhook-service:1.0.0
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: payment-webhook-config
        - secretRef:
            name: payment-webhook-secrets
        livenessProbe:
          httpGet:
            path: /webhooks/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /webhooks/health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

### Create Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payment-webhook-service
spec:
  selector:
    app: payment-webhook
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
```

---

## Nginx Reverse Proxy

### Configuration

```nginx
upstream payment_webhook {
    server localhost:3000;
}

server {
    listen 443 ssl http2;
    server_name api.payment-system.example.com;

    ssl_certificate /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=webhook_limit:10m rate=100r/m;
    limit_req zone=webhook_limit burst=10 nodelay;

    location /webhooks/ {
        limit_req zone=webhook_limit burst=20 nodelay;
        proxy_pass http://payment_webhook;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
        proxy_connect_timeout 10s;
    }

    location /api/ {
        proxy_pass http://payment_webhook;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check
    location /health {
        access_log off;
        proxy_pass http://payment_webhook/webhooks/health;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name api.payment-system.example.com;
    return 301 https://$server_name$request_uri;
}
```

---

## Monitoring & Logging

### Application Logs

Logs are output to console. For production, use a log aggregation service:

```bash
# View logs
docker logs payment-webhook

# Or with docker-compose
docker-compose logs -f api
```

### Health Check

```bash
curl http://localhost:3000/webhooks/health
```

### Database Monitoring

Monitor database connections:

```sql
-- Check active connections
SHOW PROCESSLIST;

-- Check table sizes
SELECT table_name, ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
FROM information_schema.tables
WHERE table_schema = 'payment_service'
ORDER BY size_mb DESC;
```

### Metrics to Monitor

- **Request Rate**: Webhooks received per minute
- **Error Rate**: Failed webhook processing
- **Response Time**: Average webhook processing time
- **Database Connections**: Active connections to database
- **Notification Success Rate**: Successful external notifications
- **Retry Count**: Failed notifications being retried

---

## Backup & Recovery

### Database Backup

```bash
# Full backup
mysqldump -u payment_user -p payment_service > backup_$(date +%Y%m%d_%H%M%S).sql

# Backup with compression
mysqldump -u payment_user -p payment_service | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Automated daily backup (cron)
0 2 * * * mysqldump -u payment_user -p'password' payment_service | gzip > /backups/payment_service_$(date +\%Y\%m\%d).sql.gz
```

### Database Restore

```bash
# Restore from backup
mysql -u payment_user -p payment_service < backup_20250210_120000.sql

# Restore from compressed backup
gunzip < backup_20250210_120000.sql.gz | mysql -u payment_user -p payment_service
```

---

## Troubleshooting

### Common Issues

**Issue**: Database connection failed
```
Error: connect ECONNREFUSED 127.0.0.1:3306
```
**Solution**: 
- Verify MySQL is running: `systemctl status mysql`
- Check DATABASE_URL in `.env`
- Verify credentials: `mysql -u payment_user -p`

**Issue**: Port already in use
```
Error: listen EADDRINUSE :::3000
```
**Solution**:
- Change PORT in `.env`
- Or kill existing process: `lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs kill -9`

**Issue**: Signature validation failures
```
Invalid webhook signature
```
**Solution**:
- Verify MPESA_WEBHOOK_SECRET matches operator configuration
- Check payload is JSON stringified in canonical order
- Verify signature calculation algorithm (HMAC-SHA256)

**Issue**: External notifications not being sent
```
Notification stuck in PENDING status
```
**Solution**:
- Check external webhook URL is accessible
- Verify external system is returning 200 OK
- Check notification logs: `SELECT * FROM notifications WHERE status = 'FAILED';`
- Check retry schedule: `SELECT * FROM notifications WHERE nextRetryAt > NOW();`

---

## Security Checklist

- [ ] Use HTTPS in production (SSL/TLS)
- [ ] Set strong secrets for MPESA_WEBHOOK_SECRET and NOTIFICATION_SECRET
- [ ] Enable database authentication
- [ ] Use environment variables for all secrets (never commit to git)
- [ ] Implement IP whitelisting if possible
- [ ] Enable rate limiting on webhook endpoint
- [ ] Set up firewall rules
- [ ] Enable database backups
- [ ] Monitor access logs
- [ ] Implement request validation
- [ ] Use secure headers (HSTS, X-Content-Type-Options, etc.)
- [ ] Regularly update dependencies: `pnpm update`

---

## Performance Optimization

### Database Optimization

```sql
-- Add indexes for common queries
CREATE INDEX idx_transaction_id ON payments(transactionId);
CREATE INDEX idx_status ON payments(status);
CREATE INDEX idx_payment_id ON transaction_logs(paymentId);
CREATE INDEX idx_notification_status ON notifications(status, nextRetryAt);
```

### Connection Pooling

The Drizzle ORM automatically manages connection pooling. For high-traffic scenarios, adjust:

```typescript
// In server/_core/db.ts
const pool = mysql.createPool({
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
});
```

### Caching

Consider implementing Redis for caching:

```typescript
import redis from 'redis';

const client = redis.createClient();

// Cache payment lookup
const cachedPayment = await client.get(`payment:${transactionId}`);
if (cachedPayment) {
  return JSON.parse(cachedPayment);
}
```

---

## Version Management

### Semantic Versioning

- **Major**: Breaking changes (e.g., API schema change)
- **Minor**: New features (e.g., new endpoint)
- **Patch**: Bug fixes (e.g., signature validation fix)

### Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Tag release: `git tag v1.0.0`
4. Build and test
5. Deploy to production

---

## Support & Maintenance

### Regular Maintenance Tasks

- **Weekly**: Review error logs
- **Monthly**: Verify database backups
- **Quarterly**: Update dependencies
- **Annually**: Security audit

### Getting Help

- Check logs: `docker-compose logs api`
- Review API documentation: `API_DOCUMENTATION.md`
- Check design document: `design.md`
- Review test cases: `tests/webhooks.test.ts`

---

## Rollback Procedure

If deployment fails:

```bash
# Revert to previous version
git checkout v1.0.0

# Rebuild and restart
pnpm build
pnpm start

# Or with Docker
docker pull payment-webhook-service:1.0.0
docker-compose restart
```

---

## Conclusion

This payment webhook service is now ready for deployment. Follow the steps above based on your infrastructure choice (Docker, Kubernetes, or traditional server). Always test thoroughly in a staging environment before deploying to production.

For questions or issues, refer to the API documentation or design document.
