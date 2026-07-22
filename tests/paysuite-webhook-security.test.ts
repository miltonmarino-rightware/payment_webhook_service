import crypto from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSignedWebhookMessage,
  errorResponse,
  parseWebhookTimestamp,
  verifySignature,
} from "../server/gateway/webhooks/paysuiteWebhook.routes";

const ORIGINAL_TOLERANCE = process.env.PAYSUITE_WEBHOOK_TOLERANCE_SECONDS;

afterEach(() => {
  if (ORIGINAL_TOLERANCE === undefined) {
    delete process.env.PAYSUITE_WEBHOOK_TOLERANCE_SECONDS;
  } else {
    process.env.PAYSUITE_WEBHOOK_TOLERANCE_SECONDS = ORIGINAL_TOLERANCE;
  }
});

describe("Paysuite webhook anti-replay security", () => {
  it("accepts a recent timestamp in seconds", () => {
    const nowMs = Date.UTC(2026, 6, 22, 12, 0, 0);
    const timestamp = String(Math.floor(nowMs / 1000));

    expect(parseWebhookTimestamp(timestamp, nowMs)).toBe(nowMs);
  });

  it("accepts a recent timestamp in milliseconds", () => {
    const nowMs = Date.UTC(2026, 6, 22, 12, 0, 0);

    expect(parseWebhookTimestamp(String(nowMs), nowMs)).toBe(nowMs);
  });

  it("rejects a malformed timestamp", () => {
    expect(() => parseWebhookTimestamp("not-a-timestamp")).toThrow(
      "paysuite_webhook_timestamp_invalid"
    );
  });

  it("rejects an expired timestamp outside the five-minute window", () => {
    const nowMs = Date.UTC(2026, 6, 22, 12, 10, 1);
    const oldTimestamp = String(Math.floor(Date.UTC(2026, 6, 22, 12, 5, 0) / 1000));

    expect(() => parseWebhookTimestamp(oldTimestamp, nowMs)).toThrow(
      "paysuite_webhook_timestamp_expired"
    );
  });

  it("binds the signature to both timestamp and raw body", () => {
    const secret = "local-test-webhook-secret";
    const timestamp = "1784721600";
    const rawBody = Buffer.from('{"event":"payment.success"}', "utf8");
    const signature = crypto
      .createHmac("sha256", secret)
      .update(createSignedWebhookMessage(timestamp, rawBody))
      .digest("hex");

    expect(verifySignature(rawBody, timestamp, signature, secret)).toBe(true);
    expect(verifySignature(rawBody, "1784721601", signature, secret)).toBe(false);
    expect(
      verifySignature(
        Buffer.from('{"event":"payment.failed"}', "utf8"),
        timestamp,
        signature,
        secret
      )
    ).toBe(false);
  });

  it("rejects invalid signature formats without throwing", () => {
    expect(
      verifySignature(Buffer.from("{}"), "1784721600", "invalid-signature", "secret")
    ).toBe(false);
  });

  it("sanitizes missing and invalid timestamp errors", () => {
    expect(errorResponse(new Error("paysuite_webhook_timestamp_missing"))).toEqual({
      status: 401,
      body: { received: false, error: "timestamp_required" },
    });

    expect(errorResponse(new Error("paysuite_webhook_timestamp_expired"))).toEqual({
      status: 401,
      body: { received: false, error: "invalid_timestamp" },
    });
  });
});
