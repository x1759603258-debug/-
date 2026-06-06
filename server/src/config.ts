import dotenv from "dotenv";

dotenv.config();

function configuredPort() {
  const gardenPort = Number(process.env.GARDEN_PORT);
  if (Number.isFinite(gardenPort) && gardenPort > 0) return gardenPort;

  const port = Number(process.env.PORT);
  if (Number.isFinite(port) && port > 0) return port;

  return 8788;
}

export const config = {
  port: configuredPort(),
  chatPrimaryBaseUrl: (process.env.CHAT_PRIMARY_BASE_URL ?? "").replace(/\/+$/, ""),
  chatPrimaryKey: process.env.CHAT_PRIMARY_KEY ?? "",
  chatPrimaryRetries: Number(process.env.CHAT_PRIMARY_RETRIES ?? 3),
  chatFailoverEnabled: process.env.CHAT_FAILOVER_ENABLED !== "false",
  chatPrimaryCooldownSeconds: Number(process.env.CHAT_PRIMARY_COOLDOWN_SECONDS ?? 3600),
  chatPrimaryProbeSeconds: Number(process.env.CHAT_PRIMARY_PROBE_SECONDS ?? 600),
  sub2apiBaseUrl: (process.env.SUB2API_BASE_URL ?? "").replace(/\/+$/, ""),
  sub2apiKey: process.env.SUB2API_KEY ?? "",
  adminToken: process.env.ADMIN_TOKEN ?? "",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5317,http://127.0.0.1:5317")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
};

export function hasUpstreamConfig() {
  return Boolean(config.sub2apiBaseUrl && config.sub2apiKey);
}

export function hasChatPrimaryConfig() {
  return Boolean(config.chatPrimaryBaseUrl && config.chatPrimaryKey);
}

export function requireUpstreamConfig() {
  if (!config.sub2apiBaseUrl || !config.sub2apiKey) {
    throw new Error("服务器还没有配置 SUB2API_BASE_URL 或 SUB2API_KEY。");
  }
}
