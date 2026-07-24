import { describe, expect, it } from "vitest";
import { isInternalRequestAuthorized } from "../server/operations/productionReadiness";

 describe("Production readiness primitives", () => {
  it("accepts the configured internal operations token", () => {
    expect(isInternalRequestAuthorized("secret-token", "secret-token")).toBe(true);
  });

  it("rejects a missing operations token", () => {
    expect(isInternalRequestAuthorized(undefined, "secret-token")).toBe(false);
  });

  it("fails closed when the server token is not configured", () => {
    expect(isInternalRequestAuthorized("secret-token", undefined)).toBe(false);
  });

  it("rejects a different token", () => {
    expect(isInternalRequestAuthorized("wrong-token", "secret-token")).toBe(false);
  });
});
