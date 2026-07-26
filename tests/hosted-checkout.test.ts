import { describe, expect, it } from "vitest";
import {
  calculateItemsTotal,
  mapPublicStatus,
} from "../server/gateway/payment-sessions/paymentSession.service";

describe("Hosted Checkout contract", () => {
  it("calculates totals across multiple generic items", () => {
    expect(
      calculateItemsTotal([
        { id: "ticket", name: "Ticket", quantity: 2, unitPrice: 7500 },
        { id: "fee", name: "Service", quantity: 1, unitPrice: 500 },
      ])
    ).toBe(15500);
  });

  it("does not depend on event-specific product fields", () => {
    const items = [
      { id: "sku-1", name: "Generic product", quantity: 3, unitPrice: 100 },
    ];
    expect(calculateItemsTotal(items)).toBe(300);
  });

  it.each([
    ["requires_payment_method", "created"],
    ["requires_confirmation", "payment_pending"],
    ["processing", "payment_processing"],
    ["succeeded", "payment_confirmed"],
    ["failed", "payment_failed"],
    ["cancelled", "payment_cancelled"],
    ["expired", "payment_expired"],
  ] as const)("maps %s to the stable public state %s", (internal, external) => {
    expect(mapPublicStatus(internal)).toBe(external);
  });
});
