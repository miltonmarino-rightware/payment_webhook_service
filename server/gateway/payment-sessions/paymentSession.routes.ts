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
    mpesa: { title: "M-Pesa", subtitle: "Confirme no seu telemóvel" },
    emola: { title: "e-Mola", subtitle: "Confirme no seu telemóvel" },
    bank: { title: "Transferência", subtitle: "Canal bancário" },
    card: { title: "Cartão", subtitle: "Cartão de débito ou crédito" },
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
      )}</strong><small>${escapeHtml(item.quantity)} × ${escapeHtml(
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
    if (!session) return res.status(404).send("Sessão de pagamento não encontrada");

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
          ? "Pagamento não concluído"
          : status === "cancelled"
            ? "Pagamento cancelado"
            : status === "expired"
              ? "Sessão expirada"
              : status === "processing"
                ? "A confirmar pagamento"
                : "Concluir pagamento";

    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    );
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");

    return res.type("html").send(`<!doctype html>
<html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(stateTitle)} · GATEAWAY</title>
<style>
:root{--primary:${primary};--accent:${accent};--ink:#101828;--muted:#667085;--line:#e4e7ec;--surface:#fff;--background:#f6f7f9}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top right,var(--accent),transparent 32%),var(--background);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.shell{min-height:100vh;display:grid;grid-template-columns:minmax(320px,760px) minmax(300px,460px);justify-content:center;gap:28px;padding:42px}.panel{background:rgba(255,255,255,.96);border:1px solid rgba(228,231,236,.9);border-radius:28px;box-shadow:0 28px 90px rgba(16,24,40,.10);overflow:hidden}.main{padding:34px}.summary{padding:34px;background:#101828;color:#fff}.gateway{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:32px}.gateway-mark{font-size:13px;font-weight:900;letter-spacing:.18em}.secure{font-size:12px;color:#98a2b3}.merchant{display:flex;align-items:center;gap:14px}.avatar{width:46px;height:46px;border-radius:14px;background:var(--accent);color:var(--primary);display:grid;place-items:center;font-weight:900;font-size:19px}.merchant small,.eyebrow{display:block;color:var(--muted);font-size:12px;letter-spacing:.08em;text-transform:uppercase}.merchant strong{font-size:17px}.progress{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:30px 0}.progress span{height:5px;border-radius:999px;background:#eaecf0}.progress .on{background:var(--primary)}h1{font-size:34px;line-height:1.1;margin:8px 0 10px;letter-spacing:-.03em}.lead{color:var(--muted);margin:0 0 28px}.methods{display:grid;gap:12px}.method{position:relative;display:grid;grid-template-columns:46px 1fr 22px;align-items:center;gap:14px;border:1px solid var(--line);border-radius:17px;padding:15px;cursor:pointer;transition:.18s;background:#fff}.method:hover{transform:translateY(-1px);border-color:var(--primary)}.method:has(input:checked){border-color:var(--primary);box-shadow:0 0 0 4px var(--accent)}.method input{position:absolute;opacity:0}.method-icon{width:42px;height:42px;border-radius:13px;background:var(--accent);color:var(--primary);display:grid;place-items:center;font-weight:900}.method strong,.method small{display:block}.method small{color:var(--muted);margin-top:3px}.radio{width:20px;height:20px;border:2px solid #d0d5dd;border-radius:50%}.method:has(input:checked) .radio{border:6px solid var(--primary)}.field{margin-top:18px}.field label{display:block;font-size:13px;font-weight:700;margin-bottom:8px}.field input{width:100%;height:52px;border:1px solid #d0d5dd;border-radius:14px;padding:0 16px;font-size:16px;outline:none}.field input:focus{border-color:var(--primary);box-shadow:0 0 0 4px var(--accent)}.actions{display:flex;gap:12px;margin-top:22px}.btn{border:0;border-radius:14px;min-height:52px;padding:0 20px;font-weight:800;font-size:15px;cursor:pointer;text-decoration:none;display:grid;place-items:center;text-align:center}.primary{background:var(--primary);color:#fff;flex:1}.secondary{background:#f2f4f7;color:#344054}.notice{border-radius:18px;padding:20px;background:var(--accent);color:#344054}.notice.success{background:#ecfdf3;color:#027a48}.notice.error{background:#fff1f3;color:#c01048}.spinner{width:38px;height:38px;border-radius:50%;border:4px solid var(--accent);border-top-color:var(--primary);animation:spin .9s linear infinite;margin-bottom:18px}@keyframes spin{to{transform:rotate(360deg)}}.amount{font-size:42px;font-weight:900;letter-spacing:-.04em;margin:12px 0 26px}.items{border-top:1px solid #344054;border-bottom:1px solid #344054;padding:12px 0}.item{display:flex;justify-content:space-between;gap:20px;padding:12px 0}.item strong,.item small{display:block}.item small{color:#98a2b3;margin-top:5px}.meta{display:grid;gap:14px;margin-top:22px}.meta-row{display:flex;justify-content:space-between;gap:20px}.meta-row span{color:#98a2b3}.summary-footer{margin-top:30px;padding-top:20px;border-top:1px solid #344054;color:#98a2b3;font-size:12px;line-height:1.5}.footer{margin-top:24px;color:var(--muted);font-size:12px;text-align:center}
@media(max-width:900px){.shell{grid-template-columns:1fr;max-width:720px;margin:auto;padding:20px}.summary{order:-1}.panel{border-radius:22px}}@media(max-width:520px){.shell{padding:0;gap:0}.panel{border-radius:0;border-left:0;border-right:0;box-shadow:none}.main,.summary{padding:24px}h1{font-size:29px}.amount{font-size:36px}.actions{flex-direction:column}.secondary{width:100%}}
</style></head><body><main class="shell"><section class="panel main"><div class="gateway"><div class="gateway-mark">GATEAWAY</div><div class="secure">🔒 Checkout protegido</div></div><div class="merchant"><div class="avatar">${escapeHtml(
      merchantName.charAt(0).toUpperCase()
    )}</div><div><small>A pagar a</small><strong>${escapeHtml(
      merchantName
    )}</strong></div></div><div class="progress"><span class="on"></span><span class="on"></span><span class="${
      status !== "requires_payment_method" ? "on" : ""
    }"></span><span class="${terminal ? "on" : ""}"></span></div><span class="eyebrow">Pagamento seguro</span><h1>${escapeHtml(
      stateTitle
    )}</h1><p class="lead">${escapeHtml(
      status === "requires_payment_method"
        ? "Escolha o método e confirme os dados antes de continuar."
        : status === "processing"
          ? "Confirme a solicitação no seu telemóvel. Não feche esta página."
          : status === "succeeded"
            ? "A transação foi confirmada e comunicada ao merchant."
            : "A sessão já não aceita novas confirmações."
    )}</p>${
      status === "requires_payment_method"
        ? `<form method="post" action="/checkout/${escapeHtml(
            session.id
          )}/confirm"><div class="methods">${renderMethods(
            session
          )}</div><div class="field"><label for="customerPhone">Número de pagamento</label><input id="customerPhone" name="customerPhone" inputmode="tel" autocomplete="tel" value="${escapeHtml(
            session.customer.phone
          )}" placeholder="258840000000" required></div><div class="actions"><button class="btn primary" type="submit">Confirmar pagamento</button></form><form method="post" action="/checkout/${escapeHtml(
            session.id
          )}/cancel"><button class="btn secondary" type="submit">Cancelar</button></form></div>`
        : status === "processing"
          ? `<div class="notice"><div class="spinner"></div><strong>Estamos a aguardar a confirmação.</strong><p>O estado será atualizado automaticamente.</p></div>`
          : `<div class="notice ${status === "succeeded" ? "success" : "error"}"><strong>${escapeHtml(
              stateTitle
            )}</strong><p>${escapeHtml(
              status === "succeeded"
                ? "Pode regressar ao sistema onde iniciou a compra."
                : status === "expired"
                  ? "Solicite uma nova sessão de pagamento ao merchant."
                  : "Regresse ao merchant para rever ou repetir o pedido."
            )}</p></div><div class="actions"><a class="btn primary" href="${escapeHtml(
              status === "cancelled" ? session.cancelUrl : session.returnUrl
            )}">Continuar</a></div>`
    }<p class="footer">O GATEAWAY nunca solicita PIN, palavra-passe ou código secreto.</p></section><aside class="panel summary"><span class="eyebrow">Resumo</span><div class="amount">${escapeHtml(
      amount
    )}</div><div class="items">${renderItems(
      session
    )}</div><div class="meta"><div class="meta-row"><span>Referência</span><strong>${escapeHtml(
      session.reference
    )}</strong></div><div class="meta-row"><span>Cliente</span><strong>${escapeHtml(
      session.customer.name
    )}</strong></div><div class="meta-row"><span>Moeda</span><strong>${escapeHtml(
      session.paymentIntent.currency
    )}</strong></div><div class="meta-row"><span>Expira</span><strong>${escapeHtml(
      new Intl.DateTimeFormat(session.locale, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(session.expiresAt))
    )}</strong></div></div><div class="summary-footer">Processado com segurança pelo GATEAWAY. O merchant continua responsável pelo produto, serviço, reserva ou encomenda.</div></aside></main>${
      status === "processing"
        ? `<script>setInterval(async()=>{const response=await fetch('/checkout/${escapeHtml(
            session.id
          )}/status',{cache:'no-store'});if(response.ok){const value=await response.json();if(value.paymentStatus!=='payment_processing')location.reload()}},2500)</script>`
        : ""
    }</body></html>`);
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