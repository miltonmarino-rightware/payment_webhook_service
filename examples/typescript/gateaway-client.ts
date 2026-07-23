import crypto from "crypto";

const baseUrl = process.env.GATEAWAY_BASE_URL ?? "http://localhost:3000";
const apiKey = required("GATEAWAY_API_KEY");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}:${body.error ?? "request_failed"}`);
  return body as T;
}

export async function createPaymentIntent(orderReference: string, amount: number) {
  return request<{ paymentIntent: { id: string; status: string } }>("/v1/payment_intents", {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ amount, currency: "MZN", orderReference }),
  });
}

export async function confirmPaymentIntent(id: string, customerPhone: string) {
  return request<{ paymentIntent: { id: string; status: string } }>(`/v1/payment_intents/${id}/confirm`, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ paymentMethod: "mpesa", customerPhone, provider: "mock" }),
  });
}

export async function getPaymentIntent(id: string) {
  return request<{ paymentIntent: { id: string; status: string } }>(`/v1/payment_intents/${id}`, { method: "GET" });
}
