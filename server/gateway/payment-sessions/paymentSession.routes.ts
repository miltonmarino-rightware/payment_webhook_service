import { Router, type Response } from "express";
import { enforceRateLimit, findIdempotencyRecord, hashRequestBody, requireMerchantScope, storeIdempotencyRecord, type MerchantRequest } from "../security/merchantSecurity";
import { cancelPaymentSession, confirmHostedPaymentSession, createPaymentSession, getPaymentSession, getPaymentStatus, mapPublicStatus, type CreatePaymentSessionInput } from "./paymentSession.service";

const router = Router();

function idempotencyKey(req: MerchantRequest) { const key = req.get("idempotency-key")?.trim(); return key && key.length >= 8 && key.length <= 128 ? key : null; }
function escapeHtml(value: unknown) { return String(value ?? "").replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[ch]!)); }
function errorResponse(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  const validation = ["reference_invalid","description_invalid","product_invalid","quantity_invalid","unit_price_invalid","invalid_amount","payment_amount_mismatch","unsupported_currency","customer_invalid","return_url_invalid","return_url_https_required","cancel_url_invalid","cancel_url_https_required"];
  if (validation.includes(message)) return res.status(400).json({ error: message });
  if (message === "payment_session_not_found" || message === "payment_intent_not_found") return res.status(404).json({ error: message });
  if (["payment_session_not_active","payment_session_not_cancellable","payment_intent_not_confirmable"].includes(message)) return res.status(409).json({ error: message });
  if (message.startsWith("provider_not_configured:") || message === "paysuite_api_token_missing") return res.status(503).json({ error: "provider_not_configured" });
  console.error("[PaymentSession] request failed:", message);
  return res.status(500).json({ error: "internal_error" });
}

router.post("/payment_sessions", requireMerchantScope("payment_intents:write"), enforceRateLimit, async (req: MerchantRequest, res) => {
  try {
    const key = idempotencyKey(req); if (!key) return res.status(400).json({ error: "idempotency_key_required" });
    const merchantId = req.merchant!.merchantId; const requestHash = hashRequestBody(req.body);
    const existing = await findIdempotencyRecord(merchantId, "create_payment_session", key, requestHash);
    if (existing?.responseBody && existing.responseStatus) return res.status(existing.responseStatus).json(existing.responseBody);
    const session = await createPaymentSession(merchantId, req.body as CreatePaymentSessionInput);
    const body = { paymentId: session.paymentId, sessionId: session.id, reference: session.reference, checkoutUrl: session.checkoutUrl, status: "created", expiresAt: session.expiresAt };
    await storeIdempotencyRecord({ merchantId, operation: "create_payment_session", key, requestHash, responseStatus: 201, responseBody: body, resourceId: session.id });
    return res.status(201).json(body);
  } catch (error) { return errorResponse(res, error); }
});

router.get("/payment_sessions/:id", requireMerchantScope("payment_intents:read"), enforceRateLimit, async (req: MerchantRequest, res) => {
  try { const session = await getPaymentSession(req.params.id, req.merchant!.merchantId); if (!session) return res.status(404).json({ error: "payment_session_not_found" }); return res.json({ paymentSession: session }); } catch (error) { return errorResponse(res, error); }
});

router.get("/payments/:paymentId/status", requireMerchantScope("payment_intents:read"), enforceRateLimit, async (req: MerchantRequest, res) => {
  try { const status = await getPaymentStatus(req.merchant!.merchantId, { paymentId: req.params.paymentId }); if (!status) return res.status(404).json({ error: "payment_not_found" }); return res.json(status); } catch (error) { return errorResponse(res, error); }
});

router.get("/payments/status", requireMerchantScope("payment_intents:read"), enforceRateLimit, async (req: MerchantRequest, res) => {
  try { const reference = typeof req.query.reference === "string" ? req.query.reference : undefined; if (!reference) return res.status(400).json({ error: "reference_required" }); const status = await getPaymentStatus(req.merchant!.merchantId, { reference }); if (!status) return res.status(404).json({ error: "payment_not_found" }); return res.json(status); } catch (error) { return errorResponse(res, error); }
});

router.get("/checkout/:id/status", async (req, res) => {
  try { const session = await getPaymentSession(req.params.id); if (!session) return res.status(404).json({ error: "payment_session_not_found" }); return res.json({ sessionStatus: session.status, paymentStatus: mapPublicStatus(session.paymentIntent.status), returnUrl: session.returnUrl, cancelUrl: session.cancelUrl }); } catch (error) { return errorResponse(res, error); }
});

router.get("/checkout/:id", async (req, res) => {
  try {
    const session = await getPaymentSession(req.params.id); if (!session) return res.status(404).send("Sessão de pagamento não encontrada");
    const amount = new Intl.NumberFormat("pt-MZ", { style: "currency", currency: session.paymentIntent.currency }).format(session.paymentIntent.amount);
    const terminal = ["succeeded","failed","cancelled","expired"].includes(session.paymentIntent.status);
    const stateTitle = session.paymentIntent.status === "succeeded" ? "Pagamento confirmado" : session.paymentIntent.status === "failed" ? "Pagamento falhou" : session.paymentIntent.status === "cancelled" ? "Pagamento cancelado" : session.paymentIntent.status === "expired" ? "Sessão expirada" : session.paymentIntent.status === "processing" ? "Pagamento em processamento" : "Escolha como pagar";
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    return res.type("html").send(`<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pagamento seguro</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#142033;font-family:Inter,system-ui,sans-serif}.shell{min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(680px,100%);background:white;border:1px solid #e4e8ee;border-radius:24px;box-shadow:0 24px 70px rgba(20,32,51,.10);overflow:hidden}.top{padding:24px 28px;background:#0b172a;color:#fff;display:flex;justify-content:space-between;gap:16px}.brand{font-weight:800;letter-spacing:.08em}.secure{font-size:13px;color:#b8c3d4}.content{padding:28px}.steps{display:flex;gap:8px;margin-bottom:28px}.step{flex:1;height:6px;border-radius:999px;background:#e8edf3}.step.on{background:#2563eb}.merchant{font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.08em}.title{font-size:28px;margin:8px 0 4px}.amount{font-size:38px;font-weight:800;margin:20px 0}.summary{display:grid;gap:12px;background:#f8fafc;border-radius:16px;padding:18px;margin:20px 0}.row{display:flex;justify-content:space-between;gap:20px}.label{color:#64748b}.methods{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:18px 0}.method{border:1px solid #dbe2ea;border-radius:14px;padding:16px;cursor:pointer;background:white}.method:has(input:checked){border-color:#2563eb;box-shadow:0 0 0 3px #dbeafe}.phone{width:100%;padding:14px 16px;border:1px solid #cbd5e1;border-radius:12px;font-size:16px}.actions{display:flex;gap:12px;margin-top:20px}.btn{flex:1;border:0;border-radius:12px;padding:14px 18px;font-weight:700;cursor:pointer}.primary{background:#2563eb;color:white}.secondary{background:#eef2f7;color:#334155}.notice{padding:16px;border-radius:14px;background:#eff6ff;color:#1d4ed8;margin:18px 0}.error{background:#fff1f2;color:#be123c}.footer{padding:18px 28px;border-top:1px solid #edf0f4;color:#64748b;font-size:12px}@media(max-width:560px){.methods{grid-template-columns:1fr}.actions{flex-direction:column}.content{padding:22px}.top{padding:20px 22px}}</style></head><body><main class="shell"><section class="card"><header class="top"><div class="brand">GATEAWAY</div><div class="secure">Pagamento seguro</div></header><div class="content"><div class="steps"><span class="step on"></span><span class="step on"></span><span class="step ${session.paymentIntent.status !== "requires_payment_method" ? "on" : ""}"></span><span class="step ${terminal ? "on" : ""}"></span></div><div class="merchant">${escapeHtml(session.merchantId)}</div><h1 class="title">${escapeHtml(stateTitle)}</h1><div class="amount">${escapeHtml(amount)}</div><div class="summary"><div class="row"><span class="label">Produto</span><strong>${escapeHtml(session.product.name)}</strong></div><div class="row"><span class="label">Quantidade</span><strong>${escapeHtml(session.product.quantity)}</strong></div><div class="row"><span class="label">Referência</span><strong>${escapeHtml(session.reference)}</strong></div><div class="row"><span class="label">Cliente</span><strong>${escapeHtml(session.customer.name)}</strong></div></div>${session.paymentIntent.status === "requires_payment_method" ? `<form method="post" action="/checkout/${escapeHtml(session.id)}/confirm"><div class="methods"><label class="method"><input type="radio" name="paymentMethod" value="mpesa" checked> <strong>M-Pesa</strong><div class="label">Confirmar no telemóvel</div></label><label class="method"><input type="radio" name="paymentMethod" value="emola"> <strong>e-Mola</strong><div class="label">Confirmar no telemóvel</div></label></div><input class="phone" name="customerPhone" value="${escapeHtml(session.customer.phone)}" placeholder="258840000000" required><div class="actions"><button class="btn primary" type="submit">Confirmar transação</button></form><form method="post" action="/checkout/${escapeHtml(session.id)}/cancel"><button class="btn secondary" type="submit">Cancelar</button></form></div>` : `<div class="notice ${["failed","cancelled","expired"].includes(session.paymentIntent.status) ? "error" : ""}">${session.paymentIntent.status === "processing" ? "Confirme o pedido no seu telemóvel. Esta página atualiza automaticamente." : session.paymentIntent.status === "succeeded" ? "O pagamento foi confirmado com sucesso. Pode regressar ao sistema." : "Não foi possível concluir este pagamento."}</div><div class="actions"><a class="btn primary" style="text-decoration:none;text-align:center" href="${escapeHtml(session.paymentIntent.status === "cancelled" ? session.cancelUrl : session.returnUrl)}">Continuar</a></div>`}</div><footer class="footer">Nunca partilhe PIN, palavra-passe ou código secreto com terceiros.</footer></section></main>${session.paymentIntent.status === "processing" ? `<script>setInterval(async()=>{const r=await fetch('/checkout/${escapeHtml(session.id)}/status',{cache:'no-store'});if(r.ok){const s=await r.json();if(s.paymentStatus!=='payment_processing')location.reload()}},3000)</script>` : ""}</body></html>`);
  } catch (error) { return errorResponse(res, error); }
});

router.post("/checkout/:id/confirm", async (req, res) => {
  try { const method = req.body.paymentMethod as "mpesa" | "emola" | "bank"; const provider = (process.env.GATEWAY_CHECKOUT_PROVIDER ?? (process.env.NODE_ENV === "production" ? "paysuite" : "mock")) as any; await confirmHostedPaymentSession(req.params.id, method, req.body.customerPhone, provider); return res.redirect(303, `/checkout/${encodeURIComponent(req.params.id)}`); } catch (error) { return errorResponse(res, error); }
});

router.post("/checkout/:id/cancel", async (req, res) => {
  try { const session = await cancelPaymentSession(req.params.id); return res.redirect(303, session.cancelUrl); } catch (error) { return errorResponse(res, error); }
});

export default router;
