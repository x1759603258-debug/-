import type { FastifyReply } from "fastify";
import { config, requireUpstreamConfig } from "./config.js";

const retryableStatus = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527]);

export interface UpstreamTarget {
  baseUrl: string;
  key: string;
}

export const backupUpstreamTarget = () => ({
  baseUrl: config.sub2apiBaseUrl,
  key: config.sub2apiKey
});

export const chatPrimaryTarget = () => ({
  baseUrl: config.chatPrimaryBaseUrl,
  key: config.chatPrimaryKey
});

export function upstreamUrl(endpoint: string, target = backupUpstreamTarget()) {
  if (!target.baseUrl || !target.key) requireUpstreamConfig();
  const cleanEndpoint = endpoint.replace(/^\/+/, "");
  const baseUrl = cleanEndpoint.startsWith("v1/")
    || /\/v1(?:\/)?$/i.test(target.baseUrl)
    ? target.baseUrl
    : `${target.baseUrl}/v1`;
  return `${baseUrl}/${cleanEndpoint}`;
}

export function upstreamHeaders(extra?: HeadersInit, target = backupUpstreamTarget()) {
  if (!target.baseUrl || !target.key) requireUpstreamConfig();
  const origin = new URL(target.baseUrl).origin;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${target.key}`,
    "Content-Type": "application/json",
    Accept: "application/json,text/event-stream,text/plain,*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent": process.env.SUB2API_USER_AGENT
      || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
    Origin: origin,
    Referer: `${origin}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin"
  };
  if (extra) {
    for (const [key, value] of Object.entries(extra as Record<string, string | undefined>)) {
      if (value === undefined) delete headers[key];
      else headers[key] = value;
    }
  }
  return headers;
}

function parseJson(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function stripHtml(raw: string) {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function upstreamErrorMessage(status: number, raw: string, fallback: string) {
  const parsed = parseJson(raw);
  const error = parsed?.error;
  const parsedMessage = typeof error === "string"
    ? error
    : error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : typeof parsed?.message === "string"
        ? parsed.message
        : undefined;
  const title = typeof parsed?.title === "string" ? parsed.title : undefined;
  const detail = typeof parsed?.detail === "string" ? parsed.detail : undefined;
  const retryAfter = typeof parsed?.retry_after === "number" ? parsed.retry_after : undefined;
  const cloudflare = parsed?.cloudflare_error === true || /cloudflare|bad gateway|error 50[24]|error 52[0-7]/i.test(raw);

  if (cloudflare || status === 502 || (status >= 520 && status <= 527)) {
    return `上游 AI 服务暂时不可用（${status}）。这是 api.wenxu339.com 源站/Cloudflare 返回的网关/超时错误，不是本地软件故障。${retryAfter ? `建议 ${retryAfter} 秒后重试。` : "建议稍后重试。"}`;
  }
  if (status === 429) {
    return "上游 AI 服务请求过于频繁，请稍后再试。";
  }
  if (status === 401 || status === 403) {
    return "上游 AI 服务鉴权失败，请检查后端 API Key 或接口权限。";
  }
  if (retryableStatus.has(status)) {
    return `上游 AI 服务临时异常（${status}），请稍后重试。`;
  }

  const plain = (parsedMessage || detail || title || stripHtml(raw)).slice(0, 300);
  return plain || fallback;
}

export async function pipeStream(response: Response, reply: FastifyReply) {
  if (!response.body) {
    reply.code(502).send({ error: "上游没有返回流式内容。" });
    return false;
  }

  reply.raw.writeHead(response.status, {
    "Content-Type": response.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Device-Id, Authorization"
  });

  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!reply.raw.write(Buffer.from(value))) {
        await new Promise((resolve) => reply.raw.once("drain", resolve));
      }
    }
    reply.raw.end();
    return true;
  } catch {
    reply.raw.destroy();
    return false;
  }
}
