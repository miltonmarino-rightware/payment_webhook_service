import type { PaymentMethodType } from "../types";
import type { PaymentSession } from "./paymentSession.service";
import { PAYMENT_METHOD_ASSETS } from "./paymentMethodAssets";

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

function renderMethods(session: PaymentSession): string {
  const methods = session.merchant.checkoutConfig.allowedPaymentMethods ?? ["mpesa", "emola"];
  const labels: Partial<
    Record<PaymentMethodType, { title: string; subtitle: string; logo?: string; badge?: string }>
  > = {
    mpesa: {
      title: "M-Pesa",
      subtitle: "Receba e confirme a solicitação no seu telemóvel",
      logo: PAYMENT_METHOD_ASSETS.mpesa,
      badge: "Mais usado",
    },
    emola: {
      title: "e-Mola",
      subtitle: "Confirme a solicitação diretamente no e-Mola",
      logo: PAYMENT_METHOD_ASSETS.emola,
    },
    card: {
      title: "Cartão",
      subtitle: "Visa ou Mastercard",
    },
    bank: {
      title: "Transferência bancária",
      subtitle: "Referência ou conta bancária",
    },
  };

  return methods
    .map((method, index) => {
      const label = labels[method];
      if (!label) return "";
      const visual = label.logo
        ? `<img src="${escapeHtml(label.logo)}" alt="${escapeHtml(label.title)}">`
        : `<span>${escapeHtml(label.title.slice(0, 1))}</span>`;
      return `<label class="method-card"><input type="radio" name="paymentMethod" value="${escapeHtml(
        method
      )}" ${index === 0 ? "checked" : ""}><span class="method-logo">${visual}</span><span class="method-copy"><span class="method-name">${escapeHtml(
        label.title
      )}${label.badge ? `<em>${escapeHtml(label.badge)}</em>` : ""}</span><small>${escapeHtml(
        label.subtitle
      )}</small></span><span class="method-check" aria-hidden="true"></span></label>`;
    })
    .join("");
}

function renderItems(session: PaymentSession): string {
  return session.items
    .map(
      (item) => `<div class="order-item"><div><strong>${escapeHtml(
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

function stateCopy(status: string): {
  title: string;
  lead: string;
  tone: "neutral" | "processing" | "success" | "error";
} {
  if (status === "processing") {
    return {
      title: "Confirme no seu telemóvel",
      lead: "Enviámos a solicitação ao operador. Mantenha esta página aberta enquanto confirmamos o resultado.",
      tone: "processing",
    };
  }
  if (status === "succeeded") {
    return {
      title: "Pagamento confirmado",
      lead: "A transação foi confirmada e comunicada ao sistema onde iniciou a compra.",
      tone: "success",
    };
  }
  if (status === "failed") {
    return {
      title: "Pagamento não concluído",
      lead: "Não foi possível confirmar esta transação. Regresse ao sistema para rever ou repetir o pedido.",
      tone: "error",
    };
  }
  if (status === "cancelled") {
    return {
      title: "Pagamento cancelado",
      lead: "Esta sessão já não aceita novas confirmações.",
      tone: "error",
    };
  }
  if (status === "expired") {
    return {
      title: "Sessão expirada",
      lead: "O tempo disponível terminou. Solicite uma nova sessão ao sistema onde iniciou a compra.",
      tone: "error",
    };
  }
  return {
    title: "Concluir pagamento",
    lead: "Escolha como pretende pagar e confirme os dados antes de continuar.",
    tone: "neutral",
  };
}

export function renderHostedCheckout(session: PaymentSession): string {
  const status = session.paymentIntent.status;
  const terminal = ["succeeded", "failed", "cancelled", "expired"].includes(status);
  const copy = stateCopy(status);
  const amount = new Intl.NumberFormat(session.locale, {
    style: "currency",
    currency: session.paymentIntent.currency,
  }).format(session.paymentIntent.amount);
  const merchantName = session.merchant.branding.displayName ?? session.merchant.name;
  const primary = safeColor(session.merchant.branding.primaryColor, "#C89B2B");
  const accent = safeColor(session.merchant.branding.accentColor, "#FFF6DB");
  const expiresAt = new Intl.DateTimeFormat(session.locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(session.expiresAt));
  const actionUrl = status === "cancelled" ? session.cancelUrl : session.returnUrl;

  return `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(copy.title)} · GATEAWAY</title>
<style>
:root{--merchant:${primary};--merchant-soft:${accent};--ink:#071426;--navy:#071426;--navy-2:#0b1d35;--muted:#637083;--line:#dde4ee;--canvas:#eef3f8;--surface:#fff;--gold:#c89b2b;--success:#087a4b;--success-soft:#e8f8f0;--danger:#c81e4b;--danger-soft:#fff0f4;--focus:0 0 0 4px color-mix(in srgb,var(--merchant),transparent 82%);--shadow:0 30px 80px rgba(7,20,38,.13)}
*{box-sizing:border-box}html{min-width:320px;background:var(--canvas)}body{margin:0;min-height:100vh;color:var(--ink);font-family:Inter,"Segoe UI",system-ui,-apple-system,sans-serif;background:radial-gradient(circle at 14% 4%,rgba(255,255,255,.96),transparent 34%),radial-gradient(circle at 88% 6%,var(--merchant-soft),transparent 28%),linear-gradient(145deg,#f8fafc 0%,#edf2f7 100%)}button,input{font:inherit}.page{width:min(1440px,100%);min-height:100vh;margin:auto;padding:32px;display:grid;grid-template-rows:auto 1fr auto;gap:24px}.topbar{display:flex;justify-content:space-between;align-items:center;gap:24px}.brand{display:flex;align-items:center;gap:13px}.brand-symbol{width:44px;height:44px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(145deg,#fff9e7,#fff);border:1px solid rgba(200,155,43,.35);box-shadow:0 12px 26px rgba(200,155,43,.13);font-size:19px;font-weight:900;color:var(--gold)}.brand-name{font-size:15px;font-weight:900;letter-spacing:.2em}.brand-name small{display:block;margin-top:3px;color:var(--muted);font-size:9px;letter-spacing:.17em}.trust-head{display:flex;gap:10px;align-items:center;color:var(--muted);font-size:12px}.trust-head b{width:32px;height:32px;border-radius:11px;display:grid;place-items:center;background:#fff;border:1px solid var(--line);color:var(--success)}.checkout{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(360px,.88fr);min-height:690px;border:1px solid rgba(221,228,238,.95);border-radius:34px;overflow:hidden;background:rgba(255,255,255,.82);box-shadow:var(--shadow);backdrop-filter:blur(20px)}.workspace{padding:46px 52px 42px;background:rgba(255,255,255,.97)}.summary{position:relative;padding:48px 44px;background:linear-gradient(155deg,var(--navy-2),var(--navy));color:#fff;overflow:hidden}.summary:before{content:"";position:absolute;width:420px;height:420px;border-radius:50%;right:-190px;bottom:-220px;background:radial-gradient(circle,rgba(200,155,43,.3),transparent 66%)}.summary>*{position:relative}.merchant-row{display:flex;justify-content:space-between;align-items:center;gap:18px}.merchant{display:flex;align-items:center;gap:14px}.merchant-avatar{width:48px;height:48px;border-radius:16px;display:grid;place-items:center;background:var(--merchant-soft);color:var(--merchant);font-weight:900;font-size:18px}.merchant-label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}.merchant-name{display:block;margin-top:4px;font-size:16px}.timer{padding:9px 12px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:11px;background:#fff}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:34px 0 40px}.step{display:flex;align-items:center;gap:9px;color:#98a2b3;font-size:11px}.step:before{content:"";width:9px;height:9px;border-radius:50%;background:#dce3ed;box-shadow:0 0 0 5px #f2f5f9}.step.on{color:var(--ink);font-weight:800}.step.on:before{background:var(--merchant);box-shadow:0 0 0 5px var(--merchant-soft)}.eyebrow{display:block;color:var(--merchant);font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:800}.title{font-size:clamp(36px,4vw,58px);line-height:1.02;letter-spacing:-.055em;margin:10px 0 15px;max-width:700px}.lead{margin:0 0 32px;color:var(--muted);line-height:1.65;max-width:690px}.method-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:12px}.method-heading strong{font-size:14px}.method-heading span{font-size:11px;color:var(--muted)}.methods{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.method-card{position:relative;min-height:100px;display:grid;grid-template-columns:64px 1fr 22px;align-items:center;gap:14px;padding:17px;border:1px solid var(--line);border-radius:20px;background:#fff;cursor:pointer;transition:transform .18s,border-color .18s,box-shadow .18s}.method-card:hover{transform:translateY(-2px);box-shadow:0 16px 34px rgba(7,20,38,.08)}.method-card:has(input:checked){border-color:var(--merchant);box-shadow:var(--focus),0 18px 38px rgba(7,20,38,.08)}.method-card input[type="radio"]{position:absolute;opacity:0;pointer-events:none}.method-logo{width:62px;height:62px;display:grid;place-items:center;border-radius:17px;background:#f7f9fc;overflow:hidden}.method-logo img{display:block;width:100%;height:100%;object-fit:contain;padding:6px}.method-logo span{font-size:22px;font-weight:900;color:var(--merchant)}.method-copy{min-width:0}.method-name{display:flex;align-items:center;gap:8px;font-weight:850}.method-name em{font-style:normal;font-size:8px;text-transform:uppercase;letter-spacing:.08em;padding:4px 7px;border-radius:999px;background:#fff4cf;color:#765600}.method-copy small{display:block;margin-top:6px;color:var(--muted);line-height:1.35}.method-check{width:20px;height:20px;border:2px solid #cfd7e3;border-radius:50%}.method-card:has(input:checked) .method-check{border:6px solid var(--merchant)}.future{margin-top:14px;padding:14px 16px;border:1px dashed #cfd8e5;border-radius:17px;display:flex;justify-content:space-between;gap:14px;align-items:center;color:var(--muted);font-size:11px}.future div{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.future b{padding:6px 9px;border-radius:999px;background:#f1f4f8;color:#4c5a6d;font-size:10px}.field{margin-top:22px}.field label{display:flex;justify-content:space-between;gap:12px;margin-bottom:9px;font-size:13px;font-weight:800}.field label span{font-weight:500;color:var(--muted);font-size:11px}.field input{width:100%;height:58px;border:1px solid #ccd6e3;border-radius:16px;padding:0 17px;font-size:17px;outline:none;background:#fff;color:#071426;-webkit-text-fill-color:#071426;caret-color:#071426}.field input:focus{border-color:var(--merchant);box-shadow:var(--focus)}.security-note{display:flex;gap:10px;align-items:flex-start;margin-top:13px;padding:13px 15px;border-radius:15px;background:#fff8e7;color:#725500;font-size:11px;line-height:1.5}.actions{display:flex;gap:12px;margin-top:22px}.btn{min-height:58px;border:0;border-radius:16px;padding:0 22px;display:grid;place-items:center;text-decoration:none;font-size:14px;font-weight:850;cursor:pointer;transition:transform .16s,box-shadow .16s}.btn:hover{transform:translateY(-1px)}.btn:active{transform:scale(.985)}.primary{flex:1;color:#fff;background:linear-gradient(135deg,var(--merchant),color-mix(in srgb,var(--merchant),#000 18%));box-shadow:0 15px 32px color-mix(in srgb,var(--merchant),transparent 70%)}.secondary{background:#eef2f6;color:#344054}.status-card{padding:25px;border-radius:22px;background:var(--merchant-soft);color:#344054}.status-card.processing{background:#eaf1ff;color:#1d4ed8}.status-card.success{background:var(--success-soft);color:var(--success)}.status-card.error{background:var(--danger-soft);color:var(--danger)}.status-card strong{font-size:18px}.status-card p{margin:9px 0 0;line-height:1.55}.spinner{width:42px;height:42px;margin-bottom:17px;border-radius:50%;border:4px solid rgba(255,255,255,.6);border-top-color:currentColor;animation:spin .9s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.legal{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-top:25px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:10px}.legal b{color:var(--ink);letter-spacing:.12em}.summary-label{color:#98a9bf;font-size:11px;letter-spacing:.14em;text-transform:uppercase}.amount{font-size:clamp(45px,5vw,72px);line-height:1;letter-spacing:-.06em;font-weight:900;margin:15px 0 30px}.items{padding:14px 0;border-top:1px solid rgba(255,255,255,.15);border-bottom:1px solid rgba(255,255,255,.15)}.order-item{display:flex;justify-content:space-between;gap:22px;padding:13px 0}.order-item strong,.order-item small{display:block}.order-item small{color:#98a9bf;margin-top:6px}.meta{display:grid;gap:16px;margin-top:27px}.meta-row{display:flex;justify-content:space-between;gap:20px;align-items:start}.meta-row span{color:#98a9bf}.meta-row strong{text-align:right;max-width:65%;overflow-wrap:anywhere}.assurance{margin-top:32px;padding:19px;border:1px solid rgba(255,255,255,.12);border-radius:20px;background:rgba(255,255,255,.05)}.assurance strong{display:block}.assurance p{margin:7px 0 0;color:#98a9bf;line-height:1.55;font-size:12px}.summary-footer{margin-top:22px;padding-top:20px;border-top:1px solid rgba(255,255,255,.14);color:#98a9bf;font-size:11px;line-height:1.55}.trust-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.trust-pill{min-height:62px;padding:12px 15px;border:1px solid rgba(221,228,238,.95);border-radius:18px;background:rgba(255,255,255,.75);display:flex;align-items:center;justify-content:center;gap:9px;color:#536174;font-size:11px;box-shadow:0 10px 30px rgba(7,20,38,.05)}
@media(max-width:1040px){.page{padding:20px}.checkout{grid-template-columns:1fr}.summary{order:-1;min-height:auto}.methods{grid-template-columns:1fr 1fr}.trust-strip{grid-template-columns:repeat(2,1fr)}}
@media(max-width:680px){.page{padding:0;gap:0}.topbar{padding:18px}.trust-head span{display:none}.checkout{border-radius:0;border-left:0;border-right:0;box-shadow:none}.workspace,.summary{padding:26px 20px}.summary{order:0}.title{font-size:38px}.methods{grid-template-columns:1fr}.future{align-items:flex-start;flex-direction:column}.future div{justify-content:flex-start}.actions{flex-direction:column}.secondary{width:100%}.trust-strip{grid-template-columns:1fr;padding:16px;background:#eef3f8}.legal{align-items:flex-start;flex-direction:column}.timer{display:none}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
</style>
</head>
<body>
<main class="page">
<header class="topbar"><div class="brand"><div class="brand-symbol">G</div><div class="brand-name">GATEAWAY<small>BY RIGHTWARE</small></div></div><div class="trust-head"><b>✓</b><span>Checkout seguro<br>Sessão protegida</span></div></header>
<section class="checkout">
<section class="workspace">
<div class="merchant-row"><div class="merchant"><div class="merchant-avatar">${escapeHtml(
    merchantName.charAt(0).toUpperCase()
  )}</div><div><span class="merchant-label">A pagar a</span><strong class="merchant-name">${escapeHtml(
    merchantName
  )}</strong></div></div><div class="timer">Expira ${escapeHtml(expiresAt)}</div></div>
<div class="steps"><div class="step on">Método</div><div class="step ${
    status !== "requires_payment_method" ? "on" : ""
  }">Confirmar</div><div class="step ${terminal ? "on" : ""}">Resultado</div></div>
<span class="eyebrow">Pagamento seguro</span><h1 class="title">${escapeHtml(copy.title)}</h1><p class="lead">${escapeHtml(copy.lead)}</p>
${
  status === "requires_payment_method"
    ? `<form method="post" action="/checkout/${escapeHtml(
        session.id
      )}/confirm"><div class="method-heading"><strong>Como pretende pagar?</strong><span>Métodos disponíveis para esta sessão</span></div><div class="methods">${renderMethods(
        session
      )}</div><div class="future"><span>Mais formas de pagamento</span><div><b>Cartões</b><b>Transferência</b><b>PayPal em breve</b></div></div><div class="field"><label for="customerPhone">Número associado ao pagamento <span>Formato +258</span></label><input id="customerPhone" name="customerPhone" inputmode="tel" autocomplete="off" autocapitalize="none" spellcheck="false" data-lpignore="true" data-1p-ignore="true" value="${escapeHtml(
        session.customer.phone
      )}" placeholder="+258 84 000 0000" required></div><div class="security-note"><span>◈</span><span>O GATEAWAY nunca solicita PIN, palavra-passe ou código de confirmação. Confirme apenas no canal oficial do operador.</span></div><div class="actions"><button class="btn primary" type="submit">Enviar solicitação de ${escapeHtml(
        amount
      )}</button><button class="btn secondary" type="submit" form="cancel-payment-form">Cancelar e voltar</button></div></form><form id="cancel-payment-form" method="post" action="/checkout/${escapeHtml(
        session.id
      )}/cancel"></form>`
    : status === "processing"
      ? `<div class="status-card processing"><div class="spinner"></div><strong>Estamos a confirmar o pagamento</strong><p>O estado será atualizado automaticamente. Não feche esta página.</p></div>`
      : `<div class="status-card ${copy.tone === "success" ? "success" : "error"}"><strong>${escapeHtml(
          copy.title
        )}</strong><p>${escapeHtml(copy.lead)}</p></div><div class="actions"><a class="btn primary" href="${escapeHtml(
          actionUrl
        )}">Voltar ao sistema</a></div>`
}
<div class="legal"><span>© ${new Date().getFullYear()} Rightware</span><b>PAYMENTS INFRASTRUCTURE</b></div>
</section>
<aside class="summary"><span class="summary-label">Resumo do pedido</span><div class="amount">${escapeHtml(
    amount
  )}</div><div class="items">${renderItems(session)}</div><div class="meta"><div class="meta-row"><span>Referência</span><strong>${escapeHtml(
    session.reference
  )}</strong></div><div class="meta-row"><span>Cliente</span><strong>${escapeHtml(
    session.customer.name
  )}</strong></div><div class="meta-row"><span>Moeda</span><strong>${escapeHtml(
    session.paymentIntent.currency
  )}</strong></div><div class="meta-row"><span>Expira</span><strong>${escapeHtml(
    expiresAt
  )}</strong></div></div><div class="assurance"><strong>GATEAWAY by Rightware</strong><p>Uma camada de pagamentos preparada para integrar provedores reais, mantendo cada merchant responsável pelo produto ou serviço vendido.</p></div><div class="summary-footer">Pagamento protegido por isolamento entre merchants, rastreabilidade de transações e controlos de segurança.</div></aside>
</section>
<footer class="trust-strip"><div class="trust-pill">✓ Ligação segura</div><div class="trust-pill">◈ Privacidade por design</div><div class="trust-pill">◎ Preparado para provedores</div><div class="trust-pill">MZ Construído para Moçambique</div></footer>
</main>
${
  status === "processing"
    ? `<script>setInterval(async()=>{const response=await fetch('/checkout/${escapeHtml(
        session.id
      )}/status',{cache:'no-store'});if(response.ok){const value=await response.json();if(value.paymentStatus!=='payment_processing')location.reload()}},2500)</script>`
    : ""
}
</body>
</html>`;
}
