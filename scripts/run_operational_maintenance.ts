import "dotenv/config";
import {
  collectOperationalMetrics,
  recoverStuckOutboundWebhooks,
  runRetentionMaintenance,
} from "../server/operations/productionReadiness";

async function main(): Promise<void> {
  const recovered = await recoverStuckOutboundWebhooks();
  const retention = await runRetentionMaintenance();
  const metrics = await collectOperationalMetrics();
  console.log(JSON.stringify({ recovered, retention, metrics, completedAt: new Date().toISOString() }, null, 2));
}

main().catch((error) => {
  console.error("Operational maintenance failed:", error);
  process.exitCode = 1;
});
