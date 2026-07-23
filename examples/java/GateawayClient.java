package examples.gateaway;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;

public final class GateawayClient {
  private final HttpClient http = HttpClient.newHttpClient();
  private final String baseUrl;
  private final String apiKey;

  public GateawayClient(String baseUrl, String apiKey) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  public String createPaymentIntent(String orderReference, int amount) throws Exception {
    String json = "{\"amount\":" + amount + ",\"currency\":\"MZN\",\"orderReference\":\"" + orderReference + "\"}";
    return send("/v1/payment_intents", "POST", json, UUID.randomUUID().toString());
  }

  public String confirmWithMock(String paymentIntentId, String customerPhone) throws Exception {
    String json = "{\"paymentMethod\":\"mpesa\",\"customerPhone\":\"" + customerPhone + "\",\"provider\":\"mock\"}";
    return send("/v1/payment_intents/" + paymentIntentId + "/confirm", "POST", json, UUID.randomUUID().toString());
  }

  public String getPaymentIntent(String paymentIntentId) throws Exception {
    return send("/v1/payment_intents/" + paymentIntentId, "GET", null, null);
  }

  private String send(String path, String method, String body, String idempotencyKey) throws Exception {
    HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(baseUrl + path))
        .header("x-api-key", apiKey)
        .header("accept", "application/json");
    if (idempotencyKey != null) builder.header("idempotency-key", idempotencyKey);
    if (body != null) builder.header("content-type", "application/json");
    builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
    HttpResponse<String> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new IllegalStateException("GATEAWAY HTTP " + response.statusCode() + ": " + response.body());
    }
    return response.body();
  }
}
