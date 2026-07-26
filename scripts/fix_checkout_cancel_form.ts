import fs from "node:fs";
import path from "node:path";

const target = path.resolve(
  process.cwd(),
  "server/gateway/payment-sessions/paymentSession.routes.ts"
);

const source = fs.readFileSync(target, "utf8");

if (source.includes('id="cancel-payment-form"')) {
  console.log("A correção do botão Cancelar já está aplicada.");
  process.exit(0);
}

const brokenFragment = /<div class="actions"><button class="btn primary" type="submit">Confirmar pagamento<\/button><\/form><form method="post" action="\/checkout\/\$\{escapeHtml\([\s\S]*?session\.id[\s\S]*?\)\}\/cancel"><button class="btn secondary" type="submit">Cancelar<\/button><\/form><\/div>/;

const match = source.match(brokenFragment);
if (!match) {
  throw new Error(
    "Não foi possível localizar com segurança o HTML defeituoso do checkout. Nenhum ficheiro foi alterado."
  );
}

const cancelActionMatch = match[0].match(
  /action="(\/checkout\/\$\{escapeHtml\([\s\S]*?session\.id[\s\S]*?\)\}\/cancel)"/
);
if (!cancelActionMatch?.[1]) {
  throw new Error(
    "A action do formulário de cancelamento não pôde ser extraída com segurança. Nenhum ficheiro foi alterado."
  );
}

const replacement = `<div class="actions"><button class="btn primary" type="submit">Confirmar pagamento</button><button class="btn secondary" type="submit" form="cancel-payment-form">Cancelar</button></div></form><form id="cancel-payment-form" method="post" action="${cancelActionMatch[1]}"></form>`;

const updated = source.replace(brokenFragment, replacement);
fs.writeFileSync(target, updated, "utf8");
console.log("Botão Cancelar corrigido com formulários HTML independentes.");
