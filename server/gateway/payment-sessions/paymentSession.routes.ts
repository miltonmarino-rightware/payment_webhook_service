import { Router, type Response } from "express";
import {
  enforceRateLimit,
  findIdempotencyRecord,
  hashRequestBody,
  requireMerchantScope,
  storeIdempotencyRecord,
  type MerchantRequest,
} from "../security/merchantSecurity";
import type { PaymentMethodType, ProviderCode } from "../types";
import { renderHostedCheckout } from "./hostedCheckout.view";
import {
  cancelPaymentSession,
  confirmHostedPaymentSession,
  createPaymentSession,
  getPaymentSession,
  getPaymentStatus,
  mapPublicStatus,
  type CreatePaymentSessionInput,
  type PaymentSession,
} from "./paymentSession.service";

const router = Router();

function idempotencyKey(req: MerchantRequest): string | null {
  const key = req.get("idempotency-key")?.trim();
  return key && key.length >= 8 && key.length <= 128 ? key : null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>'"]/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
      character
    ]!
  );
}

function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : fallback;
}

function errorResponse(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  const validation = new Set([
    "reference_invalid",
    "description_invalid",
    "items_invalid",
    "item_invalid",
    "quantity_invalid",
    "unit_price_invalid",
    "invalid_amount",
    "payment_amount_mismatch",
    "unsupported_currency",
    "customer_invalid",
    "return_url_invalid",
    "return_url_https_required",
    "return_url_origin_not_allowed",
    "cancel_url_invalid",
    "cancel_url_https_required",
    "cancel_url_origin_not_allowed",
    "payment_method_not_allowed",
  ]);
  if (validation.has(message)) return res.status(400).json({ error: message });
  if (
    message === "payment_session_not_found" ||
    message === "payment_intent_not_found" ||
    message === "merchant_not_found"
  ) {
    return res.status(404).json({ error: message });
  }
  if (
    [
      "payment_session_not_active",
      "payment_session_not_cancellable",
      "payment_intent_not_confirmable",
    ].includes(message)
  ) {
    return res.status(409).json({ error: message });
  }
  if (
    message.startsWith("provider_not_configured:") ||
    message === "paysuite_api_token_missing"
  ) {
    return res.status(503).json({ error: "provider_not_configured" });
  }
  console.error("[PaymentSession] request failed:", message);
  return res.status(500).json({ error: "internal_error" });
}

router.post(
  "/payment_sessions",
  requireMerchantScope("payment_intents:write"),
  enforceRateLimit,
  async (req: MerchantRequest, res) => {
    try {
      const key = idempotencyKey(req);
      if (!key) return res.status(400).json({ error: "idempotency_key_required" });
      const merchantId = req.merchant!.merchantId;
      const requestHash = hashRequestBody(req.body);
      const existing = await findIdempotencyRecord(
        merchantId,
        "create_payment_session",
        key,
        requestHash
      );
      if (existing?.responseBody && existing.responseStatus) {
        return res.status(existing.responseStatus).json(existing.responseBody);
      }
      const session = await createPaymentSession(
        merchantId,
        req.body as CreatePaymentSessionInput
      );
      const body = {
        paymentId: session.paymentId,
        sessionId: session.id,
        reference: session.reference,
        checkoutUrl: session.checkoutUrl,
        status: mapPublicStatus(session.paymentIntent.status),
        expiresAt: session.expiresAt,
      };
      await storeIdempotencyRecord({
        merchantId,
        operation: "create_payment_session",
        key,
        requestHash,
        responseStatus: 201,
        responseBody: body,
        resourceId: session.id,
      });
      return res.status(201).json(body);
    } catch (error) {
      return errorResponse(res, error);
    }
  }
);

router.get(
  "/payment_sessions/:id",
  requireMerchantScope("payment_intents:read"),
  enforceRateLimit,
  async (req: MerchantRequest, res) => {
    try {
      const session = await getPaymentSession(req.params.id, req.merchant!.merchantId);
      if (!session) return res.status(404).json({ error: "payment_session_not_found" });
      return res.json({ paymentSession: session });
    } catch (error) {
      return errorResponse(res, error);
    }
  }
);

router.get(
  "/payments/:paymentId/status",
  requireMerchantScope("payment_intents:read"),
  enforceRateLimit,
  async (req: MerchantRequest, res) => {
    try {
      const status = await getPaymentStatus(req.merchant!.merchantId, {
        paymentId: req.params.paymentId,
      });
      if (!status) return res.status(404).json({ error: "payment_not_found" });
      return res.json(status);
    } catch (error) {
      return errorResponse(res, error);
    }
  }
);

router.get(
  "/payments/status",
  requireMerchantScope("payment_intents:read"),
  enforceRateLimit,
  async (req: MerchantRequest, res) => {
    try {
      const reference =
        typeof req.query.reference === "string" ? req.query.reference : undefined;
      if (!reference) return res.status(400).json({ error: "reference_required" });
      const status = await getPaymentStatus(req.merchant!.merchantId, { reference });
      if (!status) return res.status(404).json({ error: "payment_not_found" });
      return res.json(status);
    } catch (error) {
      return errorResponse(res, error);
    }
  }
);

router.get("/checkout/:id/status", async (req, res) => {
  try {
    const session = await getPaymentSession(req.params.id);
    if (!session) return res.status(404).json({ error: "payment_session_not_found" });
    return res.json({
      sessionStatus: session.status,
      paymentStatus: mapPublicStatus(session.paymentIntent.status),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
});

function renderMethods(session: PaymentSession): string {
  const methods = session.merchant.checkoutConfig.allowedPaymentMethods ?? ["mpesa", "emola"];
  const labels: Partial<Record<PaymentMethodType, { title: string; subtitle: string }>> = {
    mpesa: { title: "M-Pesa", subtitle: "Confirme no seu telemÃ³vel" },
    emola: { title: "e-Mola", subtitle: "Confirme no seu telemÃ³vel" },
    bank: { title: "TransferÃªncia", subtitle: "Canal bancÃ¡rio" },
    card: { title: "CartÃ£o", subtitle: "CartÃ£o de dÃ©bito ou crÃ©dito" },
  };
  return methods
    .map((method, index) => {
      const label = labels[method];
      if (!label) return "";
      return `<label class="method"><input type="radio" name="paymentMethod" value="${escapeHtml(
        method
      )}" ${index === 0 ? "checked" : ""}><span class="method-icon">${escapeHtml(
        label.title.slice(0, 1)
      )}</span><span><strong>${escapeHtml(label.title)}</strong><small>${escapeHtml(
        label.subtitle
      )}</small></span><span class="radio"></span></label>`;
    })
    .join("");
}

function renderItems(session: PaymentSession): string {
  return session.items
    .map(
      (item) => `<div class="item"><div><strong>${escapeHtml(
        item.name
      )}</strong><small>${escapeHtml(item.quantity)} Ã— ${escapeHtml(
        new Intl.NumberFormat(session.locale, {
          style: "currency",
          currency: session.paymentIntent.currency,
        }).format(item.unitPrice)
      )}</small></div><b>${escapeHtml(
        new Intl.NumberFormat(session.locale, {
          style: "currency",
          currency: session.paymentIntent.currency,
        }).format(item.quantity * item.unitPrice)
      )}</b></div>`
    )
    .join("");
}

router.get("/checkout/:id", async (req, res) => {
  try {
    const session = await getPaymentSession(req.params.id);
    if (!session) return res.status(404).send("SessÃ£o de pagamento nÃ£o encontrada");

    const status = session.paymentIntent.status;
    const terminal = ["succeeded", "failed", "cancelled", "expired"].includes(status);
    const amount = new Intl.NumberFormat(session.locale, {
      style: "currency",
      currency: session.paymentIntent.currency,
    }).format(session.paymentIntent.amount);
    const merchantName =
      session.merchant.branding.displayName ?? session.merchant.name;
    const primary = safeColor(session.merchant.branding.primaryColor, "#155EEF");
    const accent = safeColor(session.merchant.branding.accentColor, "#EAF0FF");
    const stateTitle =
      status === "succeeded"
        ? "Pagamento confirmado"
        : status === "failed"
          ? "Pagamento nÃ£o concluÃ­do"
          : status === "cancelled"
            ? "Pagamento cancelado"
            : status === "expired"
              ? "SessÃ£o expirada"
              : status === "processing"
                ? "A confirmar pagamento"
                : "Concluir pagamento";

    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    );
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");

    return res.type("html").send(renderHostedCheckout(session));

  } catch (error) {
    return errorResponse(res, error);
  }
});

router.post("/checkout/:id/confirm", async (req, res) => {
  try {
    const method = req.body.paymentMethod as PaymentMethodType;
    const provider = (
      process.env.GATEWAY_CHECKOUT_PROVIDER ??
      (process.env.NODE_ENV === "production" ? "paysuite" : "mock")
    ) as ProviderCode;
    await confirmHostedPaymentSession(
      req.params.id,
      method,
      req.body.customerPhone,
      provider
    );
    return res.redirect(303, `/checkout/${encodeURIComponent(req.params.id)}`);
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.post("/checkout/:id/cancel", async (req, res) => {
  try {
    const session = await cancelPaymentSession(req.params.id);
    return res.redirect(303, session.cancelUrl);
  } catch (error) {
    return errorResponse(res, error);
  }
});

export default router;
