import "dotenv/config";
import crypto from "node:crypto";
import http from "node:http";

const port = Number(process.env.LOCAL_WEBHOOK_RECEIVER_PORT ?? 8081);
const secret = process.env.THE_BOARD_WEBHOOK_SECRET;

if (!secret) {
  console.error("THE_BOARD_WEBHOOK_SECRET não encontrada no .env.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/api/payments/webhook") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  req.on("end", () => {
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const timestamp = String(req.headers["x-gateway-timestamp"] ?? "");
    const received = String(req.headers["x-gateway-signature"] ?? "");
    const eventId = String(req.headers["x-gateway-event-id"] ?? "");
    const expectedHex = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex");
    const expected = `sha256=${expectedHex}`;
    const signatureValid =
      received.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));

    let payload: unknown = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = { invalidJson: true };
    }

    const eventType =
      payload && typeof payload === "object" && "type" in payload
        ? String((payload as { type?: unknown }).type ?? "")
        : "";

    console.log(JSON.stringify({ eventId, eventType, signatureValid }, null, 2));

    res.writeHead(signatureValid ? 200 : 401, {
      "content-type": "application/json",
    });
    res.end(JSON.stringify({ received: signatureValid }));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Recetor local de webhook ativo em http://127.0.0.1:${port}/api/payments/webhook`);
  console.log("O segredo não será mostrado no terminal.");
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
