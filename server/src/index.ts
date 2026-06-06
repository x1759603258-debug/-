import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { config, hasChatPrimaryConfig, hasUpstreamConfig } from "./config.js";
import { backupUpstreamTarget, chatPrimaryTarget, pipeStream, upstreamErrorMessage, upstreamHeaders, upstreamUrl, type UpstreamTarget } from "./proxy.js";
import {
  activateLicense,
  assertQuota,
  checkinDevice,
  consumeQuota,
  createFeedback,
  createLicense,
  deleteAdminLicense,
  ensureDevice,
  getAnnouncement,
  getAdminLicenses,
  getAdminOverview,
  getAdminFeedbacks,
  getAdminUserDetail,
  getAdminUsageLogs,
  getAdminUsers,
  getStatus,
  grantToRegisteredUsers,
  licensePlanDefaults,
  loginAccount,
  logoutDevice,
  Plan,
  publishAnnouncement,
  registerAccount,
  resolveChatModel,
  updateAdminUserDevice
} from "./store.js";

interface DeviceBody {
  deviceId?: string;
}

interface AuthBody extends DeviceBody {
  username?: string;
  password?: string;
}

interface ActivateBody extends DeviceBody {
  code?: string;
}

interface LicenseBody {
  plan?: Plan;
}

interface GrantBody {
  chat?: number;
  image?: number;
  plan?: Plan;
  reason?: string;
  announce?: boolean;
  announcementTitle?: string;
  announcementContent?: string;
}

interface AnnouncementBody {
  enabled?: boolean;
  title?: string;
  content?: string;
  mode?: "toast" | "banner" | "modal";
  durationMs?: number;
}

interface FeedbackBody extends DeviceBody {
  content?: string;
  attachments?: unknown[];
}

interface AdminUserUpdateBody {
  addChat?: number;
  addImage?: number;
  setChatRemaining?: number;
  setImageRemaining?: number;
  plan?: Plan | "none";
  memberDays?: number;
  blocked?: boolean;
  reason?: string;
}

function getDeviceId(request: { headers: Record<string, unknown>; body?: unknown; query?: unknown }) {
  const fromHeader = request.headers["x-device-id"];
  if (typeof fromHeader === "string" && fromHeader.trim()) {
    return fromHeader.trim();
  }

  const body = request.body as DeviceBody | undefined;
  if (body?.deviceId?.trim()) {
    return body.deviceId.trim();
  }

  const query = request.query as DeviceBody | undefined;
  if (query?.deviceId?.trim()) {
    return query.deviceId.trim();
  }

  throw new Error("缺少设备 ID。 ");
}

function validateAccount(username: string, password: string) {
  const messages: string[] = [];
  const name = username.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{3,19}$/.test(name)) {
    messages.push("用户名需 4-20 位，以英文字母开头，只能包含字母、数字、下划线。");
  }
  if (password.length < 8 || password.length > 32) {
    messages.push("密码需 8-32 位。");
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    messages.push("密码需同时包含字母和数字。");
  }
  if (messages.length) {
    throw new Error(messages.join("\n"));
  }
}

function modelFromBody(body: unknown) {
  if (typeof body !== "object" || body === null || !("model" in body)) return undefined;
  return String((body as { model?: unknown }).model ?? "");
}

function assertImagePayload(raw: string) {
  try {
    const payload = JSON.parse(raw) as { data?: Array<{ url?: unknown; b64_json?: unknown }> };
    const first = payload.data?.[0];
    if (typeof first?.url === "string" && first.url.trim()) return;
    if (typeof first?.b64_json === "string" && first.b64_json.trim()) return;
  } catch {
    // fall through
  }
  throw new Error("上游生图服务没有返回可用图片，本次不扣花映额度。");
}

function timeoutErrorMessage(timeoutMs: number) {
  return `上游 AI 服务等待超过 ${Math.round(timeoutMs / 1000)} 秒，已经自动停止。请稍后重试，或检查中转站图片模型是否可用。`;
}

const chatTimeoutMs = 95_000;
const imageTimeoutMs = Number(process.env.UPSTREAM_IMAGE_TIMEOUT_MS ?? 900_000);
const upstreamChatRetries = Number(process.env.UPSTREAM_CHAT_RETRIES ?? 2);
const upstreamImageRetries = Number(process.env.UPSTREAM_IMAGE_RETRIES ?? 3);
const upstreamRetryMaxDelayMs = Number(process.env.UPSTREAM_RETRY_MAX_DELAY_MS ?? 8_000);
const retryableUpstreamStatus = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527]);
const responseAttempts = new WeakMap<Response, number>();
let chatPrimaryCooldownUntil = 0;
let chatPrimaryLastProbeAt = 0;
let chatPrimaryProbePromise: Promise<void> | undefined;

function retryAfterFromBody(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { retry_after?: unknown };
    return typeof parsed.retry_after === "number" && Number.isFinite(parsed.retry_after)
      ? Math.max(1, Math.min(300, parsed.retry_after))
      : undefined;
  } catch {
    return undefined;
  }
}

function requestAbortSignal(request: FastifyRequest, reply: FastifyReply, message = "用户已停止生成，本次不扣花映额度。") {
  const controller = new AbortController();
  const abort = () => {
    if (!reply.raw.writableEnded && !controller.signal.aborted) {
      controller.abort(new Error(message));
    }
  };
  const abortIfClientClosed = () => {
    if (!reply.raw.writableEnded && reply.raw.destroyed) abort();
  };
  request.raw.on("aborted", abort);
  reply.raw.on("close", abortIfClientClosed);
  return {
    signal: controller.signal,
    cleanup: () => {
      request.raw.off("aborted", abort);
      reply.raw.off("close", abortIfClientClosed);
    }
  };
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason ?? new Error("请求已停止。"));
  const timer = setTimeout(() => controller.abort(new Error(timeoutErrorMessage(timeoutMs))), timeoutMs);
  try {
    if (upstreamSignal?.aborted) abortFromUpstream();
    upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    clearTimeout(timer);
  }
}

function attemptCount(response: Response) {
  return responseAttempts.get(response) ?? 1;
}

function messageWithRetryNote(message: string, response: Response) {
  const retries = attemptCount(response) - 1;
  return retries > 0 ? `${message}（已自动重试 ${retries} 次）` : message;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterHeaderSeconds(response: Response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

function retryDelayMs(attemptIndex: number, response: Response, rawBody: string) {
  const retryAfterSeconds = retryAfterHeaderSeconds(response) ?? retryAfterFromBody(rawBody);
  if (retryAfterSeconds !== undefined) {
    return Math.min(upstreamRetryMaxDelayMs, Math.max(800, retryAfterSeconds * 1000));
  }
  const base = [900, 1_800, 3_200, 5_000][attemptIndex] ?? 5_000;
  return Math.min(upstreamRetryMaxDelayMs, base);
}

async function fetchWithRetry(
  input: string,
  initFactory: RequestInit | (() => RequestInit | Promise<RequestInit>),
  timeoutMs: number,
  retries: number
) {
  let lastError: unknown;
  const maxAttempts = Math.max(1, retries + 1);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const init = typeof initFactory === "function" ? await initFactory() : initFactory;
      const response = await fetchWithTimeout(input, init, timeoutMs);
      responseAttempts.set(response, attempt + 1);
      if (!retryableUpstreamStatus.has(response.status) || attempt >= maxAttempts - 1) {
        return response;
      }
      const rawBody = await response.clone().text().catch(() => "");
      await sleep(retryDelayMs(attempt, response, rawBody));
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts - 1) break;
      await sleep(Math.min(upstreamRetryMaxDelayMs, [900, 1_800, 3_200, 5_000][attempt] ?? 5_000));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("上游请求失败。");
}

async function fetchChatWithFailover(body: Record<string, unknown>) {
  const primaryRetries = Math.max(0, Math.floor(config.chatPrimaryRetries));
  const primaryCoolingDown = Date.now() < chatPrimaryCooldownUntil;
  maybeProbeChatPrimary();
  const targets: Array<{ name: string; target: UpstreamTarget; retries: number }> = [];
  if (hasChatPrimaryConfig() && !primaryCoolingDown) {
    targets.push({ name: "primary", target: chatPrimaryTarget(), retries: primaryRetries });
  }
  if (hasUpstreamConfig()) {
    targets.push({ name: "backup", target: backupUpstreamTarget(), retries: upstreamChatRetries });
  }
  if (targets.length === 0) return undefined;

  let lastResponse: Response | undefined;
  for (const item of targets) {
    let response: Response;
    try {
      response = await fetchWithRetry(upstreamUrl("chat/completions", item.target), {
        method: "POST",
        headers: upstreamHeaders(undefined, item.target),
        body: JSON.stringify(body)
      }, chatTimeoutMs, item.retries);
    } catch (error) {
      if (item.name === "primary" && config.chatFailoverEnabled) {
        enterChatPrimaryCooldown();
        continue;
      }
      throw error;
    }
    if (item.name === "primary" && response.ok) {
      chatPrimaryCooldownUntil = 0;
    }
    if (response.ok || item.name === "backup" || !config.chatFailoverEnabled) {
      return response;
    }
    if (item.name === "primary") {
      enterChatPrimaryCooldown();
    }
    lastResponse = response;
    await response.text().catch(() => "");
  }
  return lastResponse;
}

function enterChatPrimaryCooldown() {
  const cooldownMs = Math.max(0, config.chatPrimaryCooldownSeconds) * 1000;
  chatPrimaryCooldownUntil = cooldownMs > 0 ? Date.now() + cooldownMs : 0;
}

function maybeProbeChatPrimary() {
  if (!hasChatPrimaryConfig() || Date.now() >= chatPrimaryCooldownUntil) return;
  const probeMs = Math.max(10, config.chatPrimaryProbeSeconds) * 1000;
  if (chatPrimaryProbePromise || Date.now() - chatPrimaryLastProbeAt < probeMs) return;
  chatPrimaryLastProbeAt = Date.now();
  chatPrimaryProbePromise = probeChatPrimary()
    .catch(() => undefined)
    .finally(() => {
      chatPrimaryProbePromise = undefined;
    });
}

async function probeChatPrimary() {
  const target = chatPrimaryTarget();
  const response = await fetchWithRetry(upstreamUrl("chat/completions", target), {
    method: "POST",
    headers: upstreamHeaders(undefined, target),
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false
    })
  }, Math.min(chatTimeoutMs, 30_000), 0);
  await response.text().catch(() => "");
  if (response.ok) {
    chatPrimaryCooldownUntil = 0;
  }
}

function latestUserText(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const latest = [...messages].reverse().find((item) => {
    return typeof item === "object" && item !== null && (item as { role?: unknown }).role === "user";
  }) as { content?: unknown } | undefined;
  const content = latest?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "object" && part !== null && "text" in part ? String((part as { text?: unknown }).text ?? "") : "").filter(Boolean).join(" ");
  }
  return "这条消息";
}

function mockChatAnswer(body: Record<string, unknown>) {
  const userText = latestUserText(body).trim() || "这条消息";
  if (/确认生成|开始生成|就这样画|可以生成|生成吧|确认绘梦/.test(userText)) {
    return "收到确认，我会开始整理这幅画面。";
  }
  return `好呀，小花园收到啦～${userText}\n\n现在是本地测试模式，我已经按真实流程回应你啦 ✨`;
}

async function sendMockChat(body: Record<string, unknown>, reply: FastifyReply) {
  const answer = mockChatAnswer(body);
  if (body.stream === true) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    for (const char of answer) {
      reply.raw.write(`data: ${JSON.stringify({ choices: [{ delta: { content: char } }] })}\n\n`);
    }
    reply.raw.write("data: [DONE]\n\n");
    reply.raw.end();
    return;
  }
  reply.header("content-type", "application/json");
  return reply.send({ choices: [{ message: { content: answer } }] });
}

function mockImage(body: Record<string, unknown>) {
  const prompt = String(body.prompt ?? "灵感花园").slice(0, 80);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8dfe8"/><stop offset="0.55" stop-color="#dff3e8"/><stop offset="1" stop-color="#dfeaff"/></linearGradient></defs><rect width="1024" height="1024" rx="88" fill="url(#g)"/><circle cx="270" cy="300" r="120" fill="#fff6"/><circle cx="730" cy="660" r="170" fill="#ffffff55"/><text x="512" y="500" text-anchor="middle" font-size="46" font-family="Microsoft YaHei, Arial" fill="#456052">本地花映测试</text><text x="512" y="570" text-anchor="middle" font-size="28" font-family="Microsoft YaHei, Arial" fill="#5f786b">${prompt.replace(/[<>&"]/g, "")}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

interface ImageEditFileInput {
  path?: string;
  name?: string;
  mimeType?: string;
  dataUrl?: string;
  imageUrl?: string;
}

interface ImageEditBody extends DeviceBody {
  model?: string;
  prompt?: string;
  size?: string;
  image?: ImageEditFileInput;
  referenceImages?: ImageEditFileInput[];
}

function bufferFromDataUrl(dataUrl: string) {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",").pop() ?? "" : dataUrl;
  return Buffer.from(base64, "base64");
}

async function filePart(file: ImageEditFileInput | undefined, fallbackName: string) {
  if (!file) return undefined;
  let bytes = file.path ? await readFile(file.path) : file.dataUrl ? bufferFromDataUrl(file.dataUrl) : undefined;
  if (!bytes && file.imageUrl) {
    const response = await fetch(file.imageUrl);
    if (!response.ok) {
      throw new Error("读取参考图失败。");
    }
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (!bytes) return undefined;
  return {
    bytes,
    name: file.name || fallbackName,
    mimeType: file.mimeType || "image/jpeg"
  };
}

async function appendImagePart(form: FormData, field: string, file: ImageEditFileInput | undefined, fallbackName: string) {
  const part = await filePart(file, fallbackName);
  if (!part) return false;
  form.append(field, new Blob([part.bytes], { type: part.mimeType }), part.name);
  return true;
}

async function buildImageEditForm(body: ImageEditBody) {
  const form = new FormData();
  form.append("model", body.model || "gpt-image-2");
  form.append("prompt", body.prompt || "请参考图片生成。 ");
  form.append("size", body.size || "1024x1024");
  const hasMainImage = await appendImagePart(form, "image", body.image, "content.jpg");
  for (const [index, file] of (body.referenceImages ?? []).entries()) {
    await appendImagePart(form, "reference_images[]", file, `reference-${index + 1}.jpg`);
  }
  if (!hasMainImage) {
    throw new Error("参考图生图缺少主体图片。 ");
  }
  return form;
}

const app = Fastify({
  logger: true,
  bodyLimit: Number(process.env.BODY_LIMIT_BYTES ?? 12 * 1024 * 1024)
});
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || config.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("不允许的跨域来源。"), false);
  }
});

app.get("/health", async () => ({ ok: true }));

app.get("/downloads/:file", async (request, reply) => {
  const params = request.params as { file?: string };
  const requestedFile = params.file || "";
  const safeFile = basename(requestedFile);
  if (!requestedFile || safeFile !== requestedFile) {
    return reply.code(400).send({ error: "无效的下载文件名。" });
  }

  const downloadsDir = resolve(process.cwd(), "updates", "downloads");
  const filePath = resolve(downloadsDir, safeFile);
  if (!filePath.startsWith(`${downloadsDir}${sep}`)) {
    return reply.code(400).send({ error: "无效的下载路径。" });
  }

  try {
    const { stat } = await import("node:fs/promises");
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return reply.code(404).send({ error: "下载文件不存在。" });
    }

    const lowerFile = safeFile.toLowerCase();
    const contentType = lowerFile.endsWith(".exe")
      ? "application/vnd.microsoft.portable-executable"
      : lowerFile.endsWith(".zip")
        ? "application/zip"
        : "application/octet-stream";
    reply.header("content-type", contentType);
    reply.header("content-length", fileStat.size);
    reply.header("content-disposition", `attachment; filename="${safeFile.replace(/"/g, "")}"`);
    return reply.send(createReadStream(filePath));
  } catch {
    return reply.code(404).send({ error: "下载文件不存在。" });
  }
});

app.get("/updates/latest.json", async () => {
  const currentVersion = "0.1.4";
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${config.port}`).replace(/\/+$/, "");
  const updateFile = process.env.APP_UPDATE_FILE || "";
  const downloadUrl = process.env.APP_UPDATE_URL || (updateFile ? `${publicBaseUrl}/downloads/${updateFile}` : undefined);
  return {
    latestVersion: process.env.APP_LATEST_VERSION || currentVersion,
    downloadUrl,
    releaseTitle: process.env.APP_RELEASE_TITLE || "晚薰更新公告",
    releaseNotes: (process.env.APP_RELEASE_NOTES || "当前已是最新测试版本。").replace(/\\n/g, "\n"),
    forceUpdate: process.env.APP_FORCE_UPDATE === "true",
    sizeBytes: Number(process.env.APP_UPDATE_SIZE_BYTES || 0) || undefined,
    sha256: process.env.APP_UPDATE_SHA256 || undefined,
    publishedAt: new Date().toISOString()
  };
});

app.get("/announcements/latest.json", async () => {
  return await getAnnouncement();
});

app.post("/feedback", async (request, reply) => {
  try {
    const body = request.body as FeedbackBody;
    const deviceId = getDeviceId(request);
    if (!body.content?.trim() && !body.attachments?.length) {
      throw new Error("请先写一点反馈内容。");
    }
    return { ok: true, feedback: await createFeedback(deviceId, body.content ?? "", body.attachments) };
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : "反馈发送失败。" };
  }
});

app.post("/trial/start", async (request) => {
  const deviceId = getDeviceId(request);
  return ensureDevice(deviceId);
});

app.get("/me", async (request) => {
  const deviceId = getDeviceId(request);
  return getStatus(deviceId);
});

app.post("/checkin", async (request, reply) => {
  try {
    const deviceId = getDeviceId(request);
    return await checkinDevice(deviceId);
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : "签到失败。" };
  }
});

app.post("/auth/register", async (request, reply) => {
  try {
    const body = request.body as AuthBody;
    const deviceId = getDeviceId(request);
    const username = body.username ?? "";
    const password = body.password ?? "";
    validateAccount(username, password);
    return await registerAccount(username, password, deviceId);
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : "注册失败。" };
  }
});

app.post("/auth/login", async (request, reply) => {
  try {
    const body = request.body as AuthBody;
    const deviceId = getDeviceId(request);
    const username = body.username ?? "";
    const password = body.password ?? "";
    return await loginAccount(username, password, deviceId);
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : "登录失败。" };
  }
});

app.post("/auth/logout", async (request, reply) => {
  try {
    const deviceId = getDeviceId(request);
    return await logoutDevice(deviceId);
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : "退出失败。" };
  }
});

app.post("/license/activate", async (request, reply) => {
  try {
    const body = request.body as ActivateBody;
    const deviceId = getDeviceId(request);
    if (!body.code?.trim()) {
      throw new Error("请输入激活码。 ");
    }
    return await activateLicense(deviceId, body.code);
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : "激活失败。" };
  }
});


function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!config.adminToken || token !== config.adminToken) {
    reply.code(401);
    return false;
  }
  return true;
}

app.get("/admin/overview", async (request, reply) => {
  if (!requireAdmin(request, reply)) return { error: "无权查看监控总览。" };
  return await getAdminOverview();
});

app.get("/admin/users", async (request, reply) => {
  if (!requireAdmin(request, reply)) return { error: "无权查看用户。" };
  return await getAdminUsers();
});


app.get("/admin/users/:deviceId", async (request, reply) => {
  if (!requireAdmin(request, reply)) return { error: "无权查看用户详情。" };
  try {
    const params = request.params as { deviceId?: string };
    return await getAdminUserDetail(decodeURIComponent(params.deviceId ?? ""));
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : "读取用户详情失败。" };
  }
});

app.patch("/admin/users/:deviceId", async (request, reply) => {
  if (!requireAdmin(request, reply)) return { error: "无权修改用户。" };
  try {
    const params = request.params as { deviceId?: string };
    const body = request.body as AdminUserUpdateBody;
    return await updateAdminUserDevice(decodeURIComponent(params.deviceId ?? ""), body);
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : "修改用户失败。" };
  }
});

app.get("/admin/usage-logs", async (request, reply) => {
  if (!requireAdmin(request, reply)) return { error: "无权查看调用日志。" };
  const query = request.query as { limit?: string };
  return await getAdminUsageLogs(Number(query.limit ?? 200));
});

app.get("/admin/feedbacks", async (request, reply) => {
  if (!requireAdmin(request, reply)) return { error: "无权查看用户反馈。" };
  const query = request.query as { limit?: string };
  return await getAdminFeedbacks(Number(query.limit ?? 200));
});

app.get("/admin/licenses", async (request, reply) => {
  if (!requireAdmin(request, reply)) return { error: "无权查看激活码。" };
  const query = request.query as { limit?: string };
  return await getAdminLicenses(Number(query.limit ?? 200));
});


app.delete("/admin/licenses/:code", async (request, reply) => {
  if (!requireAdmin(request, reply)) return { error: "无权删除激活码。" };
  try {
    const params = request.params as { code?: string };
    return await deleteAdminLicense(decodeURIComponent(params.code ?? ""));
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : "删除激活码失败。" };
  }
});

app.post("/admin/licenses", async (request, reply) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!config.adminToken || token !== config.adminToken) {
    reply.code(401);
    return { error: "无权创建激活码。" };
  }

  try {
    const body = request.body as LicenseBody;
    const plan = body.plan ?? "week";
    const defaults = licensePlanDefaults[plan];
    if (!defaults) {
      throw new Error("不支持的会员类型。");
    }

    return await createLicense({
      plan,
      quotaMode: defaults.quotaMode,
      expiresDays: defaults.expiresDays,
      dailyChatLimit: defaults.dailyChatLimit,
      dailyImageLimit: defaults.dailyImageLimit
    });
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : "创建激活码失败。" };
  }
});

app.post("/admin/grants/registered", async (request, reply) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!config.adminToken || token !== config.adminToken) {
    reply.code(401);
    return { error: "无权发放额度或会员。" };
  }

  try {
    const body = request.body as GrantBody;
    if (body.plan && !licensePlanDefaults[body.plan]) {
      throw new Error("不支持的会员类型。");
    }
    return await grantToRegisteredUsers({
      chat: body.chat,
      image: body.image,
      plan: body.plan,
      reason: body.reason,
      announce: body.announce,
      announcementTitle: body.announcementTitle,
      announcementContent: body.announcementContent
    });
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : "发放失败。" };
  }
});


app.post("/admin/announcements", async (request, reply) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!config.adminToken || token !== config.adminToken) {
    reply.code(401);
    return { error: "无权发布公告。" };
  }

  try {
    const body = request.body as AnnouncementBody;
    return await publishAnnouncement({
      enabled: body.enabled,
      title: body.title,
      content: body.content,
      mode: body.mode,
      durationMs: body.durationMs
    });
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : "发布公告失败。" };
  }
});

app.post("/admin/announcements/disable", async (request, reply) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!config.adminToken || token !== config.adminToken) {
    reply.code(401);
    return { error: "无权关闭公告。" };
  }

  return await publishAnnouncement({ enabled: false, content: "" });
});

app.post("/v1/chat/completions", async (request, reply) => {
  const deviceId = getDeviceId(request);
  const body = request.body as Record<string, unknown>;
  let model = modelFromBody(body);

  try {
    await assertQuota(deviceId, "chat");
    model = await resolveChatModel(deviceId);
    const upstreamBody = { ...body, model };
    if (!hasChatPrimaryConfig() && !hasUpstreamConfig()) {
      await sendMockChat(upstreamBody, reply);
      await consumeQuota(deviceId, "chat", model, true);
      return;
    }
    const response = await fetchChatWithFailover(upstreamBody);
    if (!response) {
      await sendMockChat(upstreamBody, reply);
      await consumeQuota(deviceId, "chat", model, true);
      return;
    }

    if (!response.ok) {
      const detail = await response.text();
      const message = messageWithRetryNote(upstreamErrorMessage(response.status, detail, `上游聊天请求失败：${response.status}`), response);
      await consumeQuota(deviceId, "chat", model, false, detail);
      reply.code(response.status);
      return { error: message, retry_after: retryAfterFromBody(detail) };
    }

    if (body.stream === true) {
      const streamed = await pipeStream(response, reply);
      await consumeQuota(deviceId, "chat", model, streamed, streamed ? undefined : "流式连接中断");
      return;
    }

    const text = await response.text();
    await consumeQuota(deviceId, "chat", model, true);
    reply.header("content-type", response.headers.get("content-type") ?? "application/json");
    return reply.send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "聊天请求失败。";
    await consumeQuota(deviceId, "chat", model, false, message);
    reply.code(message.includes("等待超过") ? 504 : 400);
    return { error: message };
  }
});

app.post("/v1/images/generations", async (request, reply) => {
  const deviceId = getDeviceId(request);
  const body = request.body as Record<string, unknown>;
  const model = "gpt-image-2";
  const upstreamBody = { ...body, model };
  const requestAbort = requestAbortSignal(request, reply);

  try {
    await assertQuota(deviceId, "image");
    if (!hasUpstreamConfig()) {
      const imageUrl = mockImage(upstreamBody);
      if (requestAbort.signal.aborted) return;
      await consumeQuota(deviceId, "image", model, true);
      return { data: [{ url: imageUrl }] };
    }
    const response = await fetchWithRetry(upstreamUrl("images/generations"), {
      method: "POST",
      headers: upstreamHeaders(),
      signal: requestAbort.signal,
      body: JSON.stringify(upstreamBody)
    }, imageTimeoutMs, upstreamImageRetries);

    const text = await response.text();
    if (requestAbort.signal.aborted) return;
    if (!response.ok) {
      const message = messageWithRetryNote(upstreamErrorMessage(response.status, text, `上游生图请求失败：${response.status}`), response);
      await consumeQuota(deviceId, "image", model, false, text);
      reply.code(response.status);
      return { error: message, retry_after: retryAfterFromBody(text) };
    }

    assertImagePayload(text);
    await consumeQuota(deviceId, "image", model, true);
    reply.header("content-type", response.headers.get("content-type") ?? "application/json");
    return reply.send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "生图请求失败。";
    if (requestAbort.signal.aborted) {
      reply.code(499);
      return { error: message };
    }
    await consumeQuota(deviceId, "image", model, false, message);
    reply.code(message.includes("等待超过") ? 504 : 400);
    return { error: message };
  } finally {
    requestAbort.cleanup();
  }
});

app.post("/v1/images/edits", async (request, reply) => {
  const deviceId = getDeviceId(request);
  const body = { ...(request.body as ImageEditBody), model: "gpt-image-2" };
  const model = body.model;
  const requestAbort = requestAbortSignal(request, reply);

  try {
    await assertQuota(deviceId, "image");
    if (!hasUpstreamConfig()) {
      const imageUrl = mockImage({ prompt: body.prompt ?? "参考图生图测试" });
      if (requestAbort.signal.aborted) return;
      await consumeQuota(deviceId, "image", model, true);
      return { data: [{ url: imageUrl }] };
    }
    const response = await fetchWithRetry(upstreamUrl("images/edits"), async () => ({
      method: "POST",
      headers: upstreamHeaders({ "Content-Type": undefined } as unknown as HeadersInit),
      signal: requestAbort.signal,
      body: await buildImageEditForm(body)
    }), imageTimeoutMs, upstreamImageRetries);

    const text = await response.text();
    if (requestAbort.signal.aborted) return;
    if (!response.ok) {
      const message = messageWithRetryNote(upstreamErrorMessage(response.status, text, `上游参考图生图请求失败：${response.status}`), response);
      await consumeQuota(deviceId, "image", model, false, text);
      reply.code(response.status);
      return { error: message, retry_after: retryAfterFromBody(text) };
    }

    assertImagePayload(text);
    await consumeQuota(deviceId, "image", model, true);
    reply.header("content-type", response.headers.get("content-type") ?? "application/json");
    return reply.send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "参考图生图请求失败。";
    if (requestAbort.signal.aborted) {
      reply.code(499);
      return { error: message };
    }
    await consumeQuota(deviceId, "image", model, false, message);
    reply.code(message.includes("等待超过") ? 504 : 400);
    return { error: message };
  } finally {
    requestAbort.cleanup();
  }
});

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
    app.log.error(`端口 ${config.port} 已被占用：请关闭旧后端进程，或在 server/.env 里修改 PORT 后重试。`);
  }
  throw error;
}
