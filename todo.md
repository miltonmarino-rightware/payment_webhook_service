# Payment Webhook Service - TODO

## Phase 1: Core Infrastructure
- [x] Create database schema for payments, transaction logs, and notifications
- [x] Set up Express server with middleware (logging, error handling)
- [x] Implement signature validation (HMAC-SHA256)
- [x] Create POST /webhooks/mpesa endpoint
- [x] Implement transaction ID validation and uniqueness check

## Phase 2: State Management
- [x] Implement payment state machine logic
- [x] Create state transition validator
- [x] Add audit logging for all state changes
- [x] Create transaction log entries for each event

## Phase 3: Notifications
- [x] Implement external webhook notification system
- [x] Add retry logic with exponential backoff
- [x] Create notification status tracking
- [x] Implement notification failure alerts

## Phase 4: Testing & Documentation
- [x] Write unit tests for validators
- [ ] Write integration tests for state transitions
- [ ] Write end-to-end webhook tests
- [x] Create API documentation
- [x] Create deployment guide

## Phase 5: Deployment & Monitoring
- [ ] Set up environment variables
- [ ] Configure database connection
- [ ] Set up logging and monitoring
- [ ] Create health check endpoint
- [ ] Deploy to production

## Phase 6: Refinement - Private Backend Service
- [x] Update README to emphasize private backend service (no UI)
- [x] Rename service to "Internal Payment Orchestrator" in documentation
- [x] Remove/hide UI layer from backend (placeholder only)
- [x] Add legal compliance notices in code
- [x] Implement immutable state enforcement (via design)
- [x] Add multi-tenant support (externalSystemId)
- [x] Enhance audit logging with mandatory fields
- [x] Create LEGAL_COMPLIANCE.md document
- [x] Update API documentation with compliance notes
- [x] Add internal-only deployment warnings


## Phase 7: STK Push Outbound Capability
- [x] Create mPesa outbound service module (mpesaOutbound.service.ts)
- [x] Create payment request endpoint (POST /payments/mpesa/request)
- [x] Implement STK Push payload construction
- [x] Add environment variables for mPesa credentials (via .env)
- [x] Create payment request validators
- [x] Add tests for STK Push flow (24 tests, all passing)
- [x] Verify idempotency and state management
- [x] Test end-to-end: request → STK Push → callback → notification


## Phase 8: Security Hardening - HMAC-SHA256 Signature Verification
- [x] Create HMAC-SHA256 signature verification middleware
- [x] Implement timing-safe signature comparison
- [x] Add replay attack protection with timestamp validation
- [x] Integrate middleware with /webhooks/mpesa endpoint
- [x] Add security audit logging (SIGNATURE_VALID, SIGNATURE_INVALID, REPLAY_ATTACK_BLOCKED)
- [x] Create comprehensive security tests (31 tests, all passing)
- [x] Verify all tests pass and TypeScript clean (75 tests total passing)


## Phase 9: Outbound Notification Signing - HMAC-SHA256
- [x] Create outbound notification signing service (notificationSigning.service.ts)
- [x] Implement per-system secret management (INTERNAL_WEBHOOK_SECRET_<systemId>)
- [x] Add signature generation to notification payload
- [x] Integrate with existing notification retry logic
- [x] Add audit logging (OUTBOUND_SIGNATURE_CREATED, OUTBOUND_NOTIFICATION_SIGNED)
- [x] Create comprehensive tests for outbound signatures (26 tests, all passing)
- [x] Verify idempotency and retry behavior with signatures
- [x] Verify all tests pass and TypeScript clean (101 tests total passing)
