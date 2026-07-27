import fs from "node:fs";
import path from "node:path";

const target = path.resolve(
  process.cwd(),
  "server/gateway/payment-sessions/paymentSession.routes.ts"
);

const source = fs.readFileSync(target, "utf8");

const newRenderMethods = `function renderMethods(session: PaymentSession): string {
  const methods = session.merchant.checkoutConfig.allowedPaymentMethods ?? ["mpesa", "emola"];
  const labels: Partial<
    Record<
      PaymentMethodType,
      { title: string; subtitle: string; logo?: string; badge?: string }
    >
  > = {
    mpesa: {
      title: "M-Pesa",
      subtitle: "Receba uma solicitação segura no seu telemóvel",
      logo: "/assets/images/m-pesa-logo.png",
      badge: "Mais usado",
    },
    emola: {
      title: "e-Mola",
      subtitle: "Confirme o pagamento diretamente no seu telemóvel",
      logo: "/assets/images/e-mola-logo.png",
    },
    bank: {
      title: "Transferência bancária",
      subtitle: "Pagamento por referência ou conta bancária",
    },
    card: {
      title: "Cartão",
      subtitle: "Visa ou Mastercard",
    },
  };

  const available = methods
    .map((method, index) => {
      const label = labels[method];
      if (!label) return "";
      const icon = label.logo
        ? \`<span class="method-logo"><img src="\${escapeHtml(label.logo)}" alt="\${escapeHtml(
            label.title
          )}"></span>\`
        : \`<span class="method-fallback">\${escapeHtml(label.title.slice(0, 1))}</span>\`;
      return \`<label class="method"><input type="radio" name="paymentMethod" value="\${escapeHtml(
        method
      )}" \${index === 0 ? "checked" : ""}><span class="method-visual">\${icon}</span><span class="method-copy"><span class="method-title-row"><strong>\${escapeHtml(
        label.title
      )}</strong>\${label.badge ? \`<em>\${escapeHtml(label.badge)}</em>\` : ""}</span><small>\${escapeHtml(
        label.subtitle
      )}</small></span><span class="method-arrow" aria-hidden="true">→</span><span class="radio"></span></label>\`;
    })
    .join("");

  return \`<div class="method-heading"><span>Escolha como pretende pagar</span><small>Métodos disponíveis para esta sessão</small></div>\${available}<div class="future-methods"><span>Próximos canais</span><div><b>Cartões</b><b>Transferência</b><b>PayPal</b></div></div>\`;
}`;

const renderMethodsPattern = /function renderMethods\(session: PaymentSession\): string \{[\s\S]*?\n\}\n\nfunction renderItems/;
if (!renderMethodsPattern.test(source)) {
  throw new Error("Bloco renderMethods não encontrado.");
}

let output = source.replace(
  renderMethodsPattern,
  `${newRenderMethods}\n\nfunction renderItems`
);

const newStyle = `<style>
:root{--primary:${"${primary}"};--accent:${"${accent}"};--navy:#07152b;--navy-2:#0b1f3a;--ink:#0b172a;--muted:#667085;--line:#dce3ee;--surface:#fff;--background:#f4f7fb;--gold:#d5a51f;--success:#087a4b;--error:#c81e4b;--shadow:0 24px 80px rgba(7,21,43,.12)}
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;min-width:320px;background:radial-gradient(circle at 88% 4%,var(--accent),transparent 28%),linear-gradient(145deg,#fff 0%,var(--background) 56%,#eef3fa 100%);color:var(--ink);font-family:"Segoe UI",Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.shell{min-height:100vh;display:grid;grid-template-columns:minmax(0,780px) minmax(330px,430px);justify-content:center;align-content:center;gap:26px;padding:32px}.panel{border:1px solid rgba(220,227,238,.94);border-radius:28px;box-shadow:var(--shadow);overflow:hidden}.main{padding:30px 34px 26px;background:rgba(255,255,255,.96);backdrop-filter:blur(18px)}.summary{position:relative;padding:34px;background:linear-gradient(155deg,var(--navy-2),var(--navy));color:#fff}.summary:after{content:"";position:absolute;inset:auto -90px -120px auto;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(213,165,31,.22),transparent 66%);pointer-events:none}.gateway{display:flex;align-items:center;justify-content:space-between;gap:18px}.brand-lockup{display:flex;align-items:center;gap:11px}.gateway-symbol{width:38px;height:38px;border:1px solid rgba(213,165,31,.35);border-radius:12px;display:grid;place-items:center;color:var(--gold);font-weight:900;font-size:20px;background:#fffaf0}.gateway-mark{font-size:17px;font-weight:900;letter-spacing:.13em}.gateway-mark small{display:block;margin-top:2px;font-size:9px;letter-spacing:.12em;color:var(--muted);font-weight:700}.secure{display:flex;align-items:center;gap:8px;font-size:12px;color:#667085}.secure-badge{width:28px;height:28px;border-radius:10px;background:#eef3f8;display:grid;place-items:center}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:26px 0}.step{display:flex;align-items:center;gap:8px;font-size:11px;color:#98a2b3}.step:before{content:"";width:22px;height:22px;border-radius:50%;background:#edf1f6;display:grid;place-items:center}.step.on{color:var(--ink);font-weight:700}.step.on:before{background:var(--gold);box-shadow:0 0 0 4px rgba(213,165,31,.12)}.merchant{display:flex;align-items:center;gap:14px;margin-bottom:22px}.avatar{width:44px;height:44px;border-radius:14px;background:var(--accent);color:var(--primary);display:grid;place-items:center;font-weight:900;font-size:18px}.merchant small,.eyebrow{display:block;color:var(--muted);font-size:11px;letter-spacing:.1em;text-transform:uppercase}.merchant strong{font-size:16px}.progress{display:none}h1{font-size:36px;line-height:1.05;margin:8px 0 10px;letter-spacing:-.045em}.lead{color:var(--muted);line-height:1.55;margin:0 0 24px}.methods{display:grid;gap:11px}.method-heading{display:flex;justify-content:space-between;align-items:end;gap:16px;margin-bottom:3px}.method-heading span{font-size:14px;font-weight:800}.method-heading small{font-size:11px;color:var(--muted)}.method{position:relative;display:grid;grid-template-columns:58px 1fr 22px;align-items:center;gap:15px;border:1px solid var(--line);border-radius:18px;padding:13px 15px;background:#fff;cursor:pointer;transition:transform .18s,border-color .18s,box-shadow .18s}.method:hover{transform:translateY(-2px);border-color:var(--primary);box-shadow:0 12px 28px rgba(7,21,43,.08)}.method:has(input:checked){border-color:var(--gold);box-shadow:0 0 0 4px rgba(213,165,31,.11),0 12px 30px rgba(7,21,43,.08);background:linear-gradient(90deg,#fffaf0,#fff)}.method input{position:absolute;opacity:0}.method-visual{width:54px;height:48px;border-radius:14px;background:#f7f9fc;display:grid;place-items:center;overflow:hidden}.method-logo{width:100%;height:100%;display:grid;place-items:center;padding:6px}.method-logo img{display:block;max-width:100%;max-height:100%;object-fit:contain}.method-fallback{font-size:20px;font-weight:900;color:var(--primary)}.method-title-row{display:flex;align-items:center;gap:9px}.method-title-row em{font-style:normal;font-size:9px;letter-spacing:.06em;text-transform:uppercase;padding:4px 7px;border-radius:999px;background:#fff1c2;color:#815f00}.method-copy strong,.method-copy small{display:block}.method-copy small{color:var(--muted);margin-top:4px;line-height:1.35}.method-arrow{color:#98a2b3;font-size:18px}.radio{position:absolute;right:15px;width:18px;height:18px;border:2px solid #d0d5dd;border-radius:50%;opacity:0}.future-methods{margin-top:2px;border:1px dashed var(--line);border-radius:15px;padding:11px 14px;display:flex;justify-content:space-between;gap:15px;align-items:center;color:var(--muted)}.future-methods>span{font-size:11px;text-transform:uppercase;letter-spacing:.08em}.future-methods div{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px}.future-methods b{font-size:10px;padding:5px 8px;border-radius:999px;background:#f3f6fa;color:#667085}.field{margin-top:18px}.field label{display:block;font-size:13px;font-weight:800;margin-bottom:8px}.field input{width:100%;height:54px;border:1px solid #cfd8e6;border-radius:15px;padding:0 16px;font-size:16px;outline:none;background:#fff}.field input:focus{border-color:var(--primary);box-shadow:0 0 0 4px var(--accent)}.security-note{display:flex;gap:10px;align-items:flex-start;margin-top:12px;padding:11px 13px;border-radius:13px;background:#fff8e6;color:#725500;font-size:11px;line-height:1.45}.actions{display:flex;gap:12px;margin-top:20px}.btn{border:0;border-radius:14px;min-height:54px;padding:0 20px;font-weight:800;font-size:14px;cursor:pointer;text-decoration:none;display:grid;place-items:center;text-align:center;transition:transform .16s,box-shadow .16s}.btn:hover{transform:translateY(-1px)}.btn:active{transform:scale(.985)}.primary{background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary),#000 16%));color:#fff;flex:1;box-shadow:0 12px 26px color-mix(in srgb,var(--primary),transparent 72%)}.secondary{background:#f0f3f7;color:#344054}.notice{border-radius:20px;padding:22px;background:var(--accent);color:#344054}.notice.success{background:#e8f8f0;color:var(--success)}.notice.error{background:#fff0f4;color:var(--error)}.spinner{width:38px;height:38px;border-radius:50%;border:4px solid rgba(255,255,255,.55);border-top-color:var(--primary);animation:spin .9s linear infinite;margin-bottom:18px}@keyframes spin{to{transform:rotate(360deg)}}.amount-label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#91a2ba}.amount{font-size:44px;font-weight:900;letter-spacing:-.05em;margin:12px 0 22px;color:#fff}.items{border-top:1px solid rgba(255,255,255,.16);border-bottom:1px solid rgba(255,255,255,.16);padding:12px 0}.item{display:flex;justify-content:space-between;gap:20px;padding:12px 0}.item strong,.item small{display:block}.item small{color:#91a2ba;margin-top:5px}.meta{display:grid;gap:14px;margin-top:22px}.meta-row{display:flex;justify-content:space-between;gap:20px;align-items:start}.meta-row span{color:#91a2ba}.meta-row strong{text-align:right;max-width:65%;overflow-wrap:anywhere}.summary-trust{margin-top:26px;padding:16px;border:1px solid rgba(255,255,255,.12);border-radius:17px;background:rgba(255,255,255,.05)}.summary-trust strong{display:block;font-size:13px}.summary-trust small{display:block;margin-top:5px;color:#91a2ba;line-height:1.5}.summary-footer{margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,.14);color:#91a2ba;font-size:11px;line-height:1.55}.footer{margin:18px 0 0;color:var(--muted);font-size:11px;text-align:center}.rightware-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:20px;padding-top:15px;border-top:1px solid var(--line);font-size:10px;color:var(--muted)}.rightware-footer b{color:var(--ink);letter-spacing:.08em}.trust-strip{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.trust-pill{min-height:58px;border:1px solid rgba(220,227,238,.9);border-radius:16px;background:rgba(255,255,255,.78);display:flex;align-items:center;justify-content:center;gap:9px;padding:10px 13px;color:#526173;font-size:11px;box-shadow:0 10px 28px rgba(7,21,43,.05)}
@media(max-width:980px){.shell{grid-template-columns:1fr;max-width:760px;margin:auto;padding:20px}.summary{order:-1}.trust-strip{grid-template-columns:repeat(2,1fr)}}@media(max-width:560px){.shell{padding:0;gap:0}.panel{border-radius:0;border-left:0;border-right:0;box-shadow:none}.main,.summary{padding:22px}.summary{order:0}.gateway-mark{font-size:14px}.secure span:last-child{display:none}.steps{margin:20px 0}.step{font-size:0}.step:after{font-size:10px}.merchant{margin-bottom:18px}h1{font-size:30px}.amount{font-size:38px}.method-heading{align-items:start;flex-direction:column;gap:2px}.method{grid-template-columns:50px 1fr 18px;padding:12px}.method-visual{width:46px;height:44px}.method-copy small{font-size:11px}.future-methods{align-items:flex-start;flex-direction:column}.future-methods div{justify-content:flex-start}.actions{flex-direction:column}.secondary{width:100%}.trust-strip{grid-template-columns:1fr;padding:14px;background:#f4f7fb}.rightware-footer{flex-direction:column;align-items:flex-start}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
</style>`;

const stylePattern = /<style>[\s\S]*?<\/style>/;
if (!stylePattern.test(output)) {
  throw new Error("Bloco CSS não encontrado.");
}
output = output.replace(stylePattern, newStyle);

const oldHeader = `<section class="panel main"><div class="gateway"><div class="gateway-mark">GATEAWAY</div><div class="secure">🔒 Checkout protegido</div></div><div class="merchant">`;
const newHeader = `<section class="panel main"><div class="gateway"><div class="brand-lockup"><div class="gateway-symbol">G</div><div class="gateway-mark">GATEAWAY<small>BY RIGHTWARE</small></div></div><div class="secure"><span class="secure-badge">✓</span><span>Checkout seguro<br>Sessão protegida</span></div></div><div class="steps"><div class="step on">Método</div><div class="step ${"${status !== \"requires_payment_method\" ? \"on\" : \"\"}"}">Confirmar</div><div class="step ${"${terminal ? \"on\" : \"\"}"}">Concluído</div></div><div class="merchant">`;
if (!output.includes(oldHeader)) {
  throw new Error("Cabeçalho antigo não encontrado.");
}
output = output.replace(oldHeader, newHeader);

const oldField = `</div><div class="field"><label for="customerPhone">Número associado ao pagamento</label><input id="customerPhone" name="customerPhone" inputmode="tel" autocomplete="tel" value="${"${escapeHtml("}`;
if (!output.includes(oldField)) {
  throw new Error("Campo de telefone antigo não encontrado.");
}
output = output.replace(
  oldField,
  `</div><div class="field"><label for="customerPhone">Número associado ao pagamento</label><input id="customerPhone" name="customerPhone" inputmode="tel" autocomplete="tel" value="${"${escapeHtml("}`
);

output = output.replace(
  `placeholder="258840000000" required></div><div class="actions">`,
  `placeholder="+258 84 000 0000" required></div><div class="security-note"><span>◈</span><span>O GATEAWAY nunca solicita PIN, palavra-passe ou código de confirmação. Confirme apenas no canal oficial do operador.</span></div><div class="actions">`
);

output = output.replace(
  `<p class="footer">O GATEAWAY nunca solicita PIN, palavra-passe ou código de confirmação.</p></section><aside class="panel summary"><span class="eyebrow">Resumo</span><div class="amount">`,
  `<div class="rightware-footer"><span>© ${new Date().getFullYear()} Rightware</span><b>PAYMENTS INFRASTRUCTURE</b></div></section><aside class="panel summary"><span class="amount-label">Resumo do pedido</span><div class="amount">`
);

output = output.replace(
  `<div class="summary-footer">Pagamento processado com segurança pelo GATEAWAY. A empresa onde iniciou a compra continua responsável pelo produto, serviço, reserva ou encomenda.</div></aside></main>`,
  `<div class="summary-trust"><strong>GATEAWAY by Rightware</strong><small>Infraestrutura preparada para integração com provedores reais, mantendo o merchant responsável pelo produto, serviço, reserva ou encomenda.</small></div><div class="summary-footer">Pagamento protegido por controlos de segurança, isolamento por merchant e rastreabilidade de transações.</div></aside><div class="trust-strip"><div class="trust-pill">✓ Ligação segura</div><div class="trust-pill">◈ Privacidade por design</div><div class="trust-pill">◎ Preparado para provedores</div><div class="trust-pill">🇲🇿 Construído para Moçambique</div></div></main>`
);

output = output.replace(
  `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`
);

fs.writeFileSync(target, output, "utf8");
console.log("Premium Hosted Checkout UI aplicada com sucesso.");
