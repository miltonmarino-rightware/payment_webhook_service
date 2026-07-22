import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  calculateBackoffSeconds,
  createOutboundSignature,
  isPrivateAddress,
  shouldRetryStatus,
} from "../server/gateway/webhooks/outboundWebhook.service";

describe("Outbound webhook security", () => {
  it("binds the HMAC signature to timestamp and body", () => {
    const timestamp = "1784725200";
    const body = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });
    const secret = "test-secret";
    const signature = createOutboundSignature(timestamp, body, secret);
    const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
    expect(signature).toBe(expected);
    expect(createOutboundSignature("1784725201", body, secret)).not.toBe(signature);
    expect(createOutboundSignature(timestamp, `${body} `, secret)).not.toBe(signature);
  });

  it("uses bounded exponential backoff", () => {
    expect(calculateBackoffSeconds(1)).toBe(5);
    expect(calculateBackoffSeconds(2)).toBe(10);
    expect(calculateBackoffSeconds(3)).toBe(20);
    expect(calculateBackoffSeconds(20)).toBe(3600);
  });

  it("retries transient HTTP failures", () => {
    expect(shouldRetryStatus(408)).toBe(true);
    expect(shouldRetryStatus(429)).toBe(true);
    expect(shouldRetryStatus(503)).toBe(true);
    expect(shouldRetryStatus(400)).toBe(false);
    expect(shouldRetryStatus(401)).toBe(false);
  });

  it("recognizes private IPv4 destinations", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.10.0.1")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("192.168.1.10")).toBe(true);
    expect(isPrivateAddress("169.254.1.1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });

  it("recognizes private IPv6 destinations", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });
});
