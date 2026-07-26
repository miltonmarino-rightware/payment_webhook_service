import fs from "node:fs";
import path from "node:path";

const target = path.resolve(
  process.cwd(),
  "server/gateway/payment-sessions/paymentSession.routes.ts"
);

const source = fs.readFileSync(target, "utf8");

const oldFragment = `? \`<form method="post" action="/checkout/\${escapeHtml(
            session.id
          )}/confirm"><div class="methods">\${renderMethods(
            session
          )}</div><div class="field"><label for="customerPhone">Número de pagamento</label><input id="customerPhone" name="customerPhone" inputmode="tel" autocomplete="tel" value="\${escapeHtml(
            session.customer.phone
          )}" placeholder="258840000000" required></div><div class="actions"><button class="btn primary" type="submit">Confirmar pagamento</button></form><form method="post" action="/checkout/\${escapeHtml(
            session.id
          )}/cancel"><button class="btn secondary" type="submit">Cancelar</button></form></div>\``;

const newFragment = `? \`<form method="post" action="/checkout/\${escapeHtml(
            session.id
          )}/confirm"><div class="methods">\${renderMethods(
            session
          )}</div><div class="field"><label for="customerPhone">Número de pagamento</label><input id="customerPhone" name="customerPhone" inputmode="tel" autocomplete="tel" value="\${escapeHtml(
            session.customer.phone
          )}" placeholder="258840000000" required></div><div class="actions"><button class="btn primary" type="submit">Confirmar pagamento</button><button class="btn secondary" type="submit" form="cancel-payment-form">Cancelar</button></div></form><form id="cancel-payment-form" method="post" action="/checkout/\${escapeHtml(
            session.id
          )}/cancel"></form>\``;

if (!source.includes(oldFragment)) {
  if (source.includes('id="cancel-payment-form"')) {
    console.log("A correção do botão Cancelar já está aplicada.");
    process.exit(0);
  }

  throw new Error(
    "Não foi possível localizar o fragmento antigo do checkout. Nenhum ficheiro foi alterado."
  );
}

fs.writeFileSync(target, source.replace(oldFragment, newFragment), "utf8");
console.log("Botão Cancelar corrigido com formulários HTML independentes.");
