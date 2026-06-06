import type { IpcMainInvokeEvent } from "electron";
import { readFile } from "node:fs/promises";
import type { ChatMessage, ChatRequest, ChatSession, MessageFile } from "../../src/lib/desktopApi.js";
import { isDreamDraftContent } from "../../src/lib/dreamIntent.js";
import { platformHeaders, platformUrl } from "./platformClient.js";
import { extractErrorMessage } from "./platformResponse.js";
import { getSettings } from "./settingsStore.js";
import { createMessage, getSession, saveInputFiles, touchSession, upsertSession } from "./sessionStore.js";
import { generateImage } from "./imageGenerationClient.js";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface CompletionMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

interface CompletionPayload {
  choices?: Array<{
    message?: { content?: unknown };
    delta?: { content?: unknown };
    text?: unknown;
  }>;
}

interface RunOptions {
  event: IpcMainInvokeEvent;
  request: ChatRequest;
  baseDir: string;
  fallbackTitle: string;
  systemPrompt: string;
  startChannel: string;
  chunkChannel: string;
  abortControllers: Map<string, AbortController>;
}

const maxContextMessages = 16;
const textSnippetLimit = 12_000;
const chatCompletionTimeoutMs = 90_000;
const maxVisibleImageProgress = 96;

function truncateForRetry(messages: ChatMessage[], retryMessageId?: string) {
  if (!retryMessageId) return messages;
  const retryIndex = messages.findIndex((message) => message.id === retryMessageId);
  return retryIndex >= 0 ? messages.slice(0, retryIndex) : messages;
}

function titleFromMessage(message: string, fallbackTitle: string) {
  return message.trim().slice(0, 18) || fallbackTitle;
}

function createAssistantMessage(id?: string, pendingImage = false): ChatMessage {
  return {
    ...createMessage("assistant", ""),
    id: id || crypto.randomUUID(),
    status: "pending",
    pendingImage
  };
}

function imageContext(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.role === "user" || (message.role === "assistant" && (message.imagePrompt || message.imageUrl || message.content)))
    .slice(-10)
    .map((message) => {
      if (message.role === "user") return `用户：${message.content}`;
      const imageLine = message.imagePrompt ? `出图提示：${message.imagePrompt}` : message.content;
      return message.imageUrl ? `花映：${imageLine}\n已生成图片：已生成过图片，继续参考上一张画面，不要把图片数据写进提示词。` : `花映：${imageLine}`;
    })
    .join("\n\n");
}

function huayingPrompt(existingMessages: ChatMessage[], userMessage: ChatMessage) {
  const context = imageContext(existingMessages);
  const attached = (userMessage.files ?? []).filter((file) => file.kind === "image").map((file) => file.name);
  return [
    "你要根据同一花映会话里的历史内容理解用户本轮需求，并直接生成新图。",
    "如果用户说修改、换成、延续、上一张、这张图等，要以上文最近一次图片提示和已生成图片为基础理解。",
    context ? `【会话上下文】\n${context}` : "",
    `【用户本轮】\n${userMessage.content || "请根据参考图生成图片。"}`,
    attached.length ? `【本轮参考图】\n${attached.join("、")}` : "",
    "请把以上内容融合成最终图像生成提示词。不要回答用户，不要解释，只生成图片。"
  ].filter(Boolean).join("\n\n");
}

function latestGeneratedImageFile(messages: ChatMessage[]) {
  const message = [...messages].reverse().find((item) => item.role === "assistant" && item.imageUrl);
  if (!message?.imageUrl) return undefined;
  return {
    name: `previous-${message.id}.png`,
    mimeType: "image/png",
    size: 0,
    dataUrl: message.imageUrl
  };
}

function withTimeoutSignal(parentSignal: AbortSignal, timeoutMs: number, timeoutMessage = "请求等待太久，已经自动停止。") {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(new Error(timeoutMessage)), timeoutMs);
  const abort = () => timeoutController.abort(parentSignal.reason);
  if (parentSignal.aborted) abort();
  else parentSignal.addEventListener("abort", abort, { once: true });
  return {
    signal: timeoutController.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", abort);
    }
  };
}

function isTextLike(file: MessageFile) {
  const name = file.name.toLowerCase();
  return file.mimeType.startsWith("text/")
    || file.mimeType.includes("json")
    || name.endsWith(".txt")
    || name.endsWith(".md")
    || name.endsWith(".csv");
}

function isPdf(file: MessageFile) {
  return file.mimeType.includes("pdf") || file.name.toLowerCase().endsWith(".pdf");
}

function isWord(file: MessageFile) {
  return /\.(docx?)$/i.test(file.name);
}

function isSheet(file: MessageFile) {
  return /\.(xlsx?|csv)$/i.test(file.name);
}

function limitSnippet(text: string) {
  return text.replace(/\r/g, "").trim().slice(0, textSnippetLimit);
}

async function installPdfCanvasGlobals() {
  try {
    const canvas = await import("@napi-rs/canvas");
    const target = globalThis as Record<string, unknown>;
    target.DOMMatrix ??= canvas.DOMMatrix;
    target.ImageData ??= canvas.ImageData;
    target.Path2D ??= canvas.Path2D;
  } catch {
    // PDF text extraction can still fail gracefully without canvas globals.
  }
}

async function extractPdfText(buffer: Buffer) {
  await installPdfCanvasGlobals();
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractWordText(filePath: string) {
  const mammoth = await import("mammoth");
  const reader = mammoth.default ?? mammoth;
  const result = await reader.extractRawText({ path: filePath });
  return result.value;
}

async function extractSheetText(filePath: string) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  return workbook.SheetNames.slice(0, 6).map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ",", RS: "\n" });
    return `?${sheetName}?\n${csv}`;
  }).join("\n\n");
}

async function textSnippet(file: MessageFile) {
  if (!file.localPath) return "";
  try {
    if (isTextLike(file)) {
      return limitSnippet(await readFile(file.localPath, "utf-8"));
    }
    if (isPdf(file)) {
      return limitSnippet(await extractPdfText(await readFile(file.localPath)));
    }
    if (isWord(file)) {
      return limitSnippet(await extractWordText(file.localPath));
    }
    if (isSheet(file)) {
      return limitSnippet(await extractSheetText(file.localPath));
    }
  } catch {
    return "";
  }
  return "";
}

async function textWithFiles(content: string, files: MessageFile[] = []) {
  if (!files.length) return content;
  const fileLines = files.map((file) => `- ${file.name}（${file.mimeType || file.kind}，${file.size} bytes）`);
  const snippets = (await Promise.all(files.map(async (file) => {
    const snippet = await textSnippet(file);
    return snippet ? `【${file.name} 内容节选】\n${snippet}` : "";
  }))).filter(Boolean);

  return [
    content,
    `用户附加了 ${files.length} 个文件：\n${fileLines.join("\n")}`,
    ...snippets
  ].filter(Boolean).join("\n\n");
}

async function completionContent(message: ChatMessage): Promise<string | ContentPart[]> {
  const text = await textWithFiles(message.content, message.files);
  const imageFiles = (message.files ?? []).filter((file) => file.kind === "image" && file.dataUrl);
  if (!imageFiles.length) return text;
  return [
    { type: "text", text: text || "请分析这些图片。" },
    ...imageFiles.map((file) => ({ type: "image_url" as const, image_url: { url: file.dataUrl ?? "" } }))
  ];
}

async function completionMessages(systemPrompt: string, messages: ChatMessage[]): Promise<CompletionMessage[]> {
  const selected = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-maxContextMessages);
  const converted: CompletionMessage[] = [{ role: "system", content: systemPrompt }];

  for (const message of selected) {
    if (message.role === "assistant") {
      converted.push({
        role: "assistant",
        content: message.imageUrl ? `${message.content}\n[已生成图片] ${message.imageUrl}` : message.content
      });
      continue;
    }
    converted.push({ role: "user", content: await completionContent(message) });
  }

  return converted;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const value = "text" in part ? (part as { text?: unknown }).text : undefined;
    return typeof value === "string" ? value : "";
  }).join("");
}

function assistantText(payload: CompletionPayload) {
  const choice = payload.choices?.[0];
  return contentText(choice?.message?.content)
    || contentText(choice?.delta?.content)
    || contentText(choice?.text);
}

function assistantTextFromJson(data: string) {
  try {
    return assistantText(JSON.parse(data) as CompletionPayload);
  } catch {
    return "";
  }
}

function isCompletionPayload(payload: unknown) {
  return Boolean(
    payload
      && typeof payload === "object"
      && "choices" in payload
      && Array.isArray((payload as { choices?: unknown }).choices)
  );
}

function textFromCompletionResponse(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  try {
    const payload = JSON.parse(trimmed) as unknown;
    if (isCompletionPayload(payload)) {
      return assistantText(payload as CompletionPayload);
    }
  } catch {
    // Non-JSON text is handled below.
  }

  let streamed = "";
  for (const line of trimmed.split(/\r?\n/)) {
    const lineText = line.trim();
    if (!lineText.startsWith("data:")) continue;
    const data = lineText.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    streamed += assistantTextFromJson(data);
  }
  if (streamed.trim()) return streamed;

  return /^\s*data:/m.test(trimmed) ? "" : trimmed;
}

function ensureVisibleAssistantContent(content: string, context: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error(`${context}返回为空，请稍后再试。`);
  }
  return content;
}

async function readNonStreamCompletion(messages: CompletionMessage[], signal?: AbortSignal, errorFallback = "轻语请求失败。") {
  const settings = await getSettings();
  const response = await fetch(await platformUrl("v1/chat/completions"), {
    method: "POST",
    headers: await platformHeaders(),
    signal,
    body: JSON.stringify({
      model: settings.chatModel,
      stream: false,
      messages
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(extractErrorMessage(text, errorFallback));
  }
  return textFromCompletionResponse(text);
}

async function readNonStreamCompletionWithRetry(messages: CompletionMessage[], signal?: AbortSignal, errorFallback = "轻语请求失败。") {
  const first = await readNonStreamCompletion(messages, signal, errorFallback);
  if (first.trim()) return first;
  return readNonStreamCompletion(messages, signal, errorFallback);
}

async function readStreamCompletion(messages: CompletionMessage[], signal: AbortSignal, onDelta: (delta: string) => void) {
  const settings = await getSettings();
  const response = await fetch(await platformUrl("v1/chat/completions"), {
    method: "POST",
    headers: await platformHeaders(),
    signal,
    body: JSON.stringify({
      model: settings.chatModel,
      stream: true,
      messages
    })
  });

  if (!response.ok) {
    throw new Error(extractErrorMessage(await response.text(), "轻语请求失败。"));
  }
  if (!response.body) {
    return readNonStreamCompletion(messages, signal);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let answer = "";
  let rawText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    rawText += text;
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const delta = assistantTextFromJson(data);
      if (!delta) continue;
      answer += delta;
      onDelta(delta);
    }
  }

  const remaining = buffer.trim();
  if (remaining) {
    const data = remaining.startsWith("data:") ? remaining.slice(5).trim() : remaining;
    if (data && data !== "[DONE]") {
      const delta = assistantTextFromJson(data);
      if (delta) {
        answer += delta;
        onDelta(delta);
      }
    }
  }

  if (answer.trim()) return answer;
  return textFromCompletionResponse(rawText);
}

async function readDreamChatCompletion(messages: CompletionMessage[], signal: AbortSignal, onDelta: (delta: string) => void) {
  const streamed = await readStreamCompletion(messages, signal, onDelta);
  if (streamed.trim()) return streamed;
  return readNonStreamCompletionWithRetry(messages, signal, "绘梦请求失败。");
}

function isDreamDraftMessage(message: ChatMessage) {
  return message.role === "assistant" && isDreamDraftContent(message.content);
}

async function persistSession(baseDir: string, session: ChatSession) {
  return upsertSession(baseDir, session);
}

export async function runChatConversation(options: RunOptions) {
  const session = await getSession(options.baseDir, options.request.sessionId, options.fallbackTitle);
  const existingMessages = truncateForRetry(session.messages, options.request.retryMessageId);
  const savedFiles = await saveInputFiles(options.baseDir, session.id, options.request.files);
  const userMessage = createMessage("user", options.request.message, savedFiles);
  const assistantMessage = createAssistantMessage(options.request.optimisticAssistantId);
  const messages = [...existingMessages, userMessage, assistantMessage];
  let nextSession = touchSession(session, messages, titleFromMessage(options.request.message, options.fallbackTitle));
  await persistSession(options.baseDir, nextSession);

  const abortController = new AbortController();
  options.abortControllers.set(session.id, abortController);
  options.event.sender.send(options.startChannel, { sessionId: session.id, messageId: assistantMessage.id });

  try {
    const completionInput = await completionMessages(options.systemPrompt, [...existingMessages, userMessage]);
    assistantMessage.content = ensureVisibleAssistantContent(await readStreamCompletion(completionInput, abortController.signal, (delta) => {
      assistantMessage.content += delta;
      options.event.sender.send(options.chunkChannel, { sessionId: session.id, messageId: assistantMessage.id, delta });
    }), options.fallbackTitle);
    assistantMessage.status = "done";
    assistantMessage.pendingImage = false;
    assistantMessage.confirmImage = isDreamDraftMessage(assistantMessage);
    nextSession = touchSession(session, [...existingMessages, userMessage, assistantMessage], titleFromMessage(options.request.message, options.fallbackTitle));
    return persistSession(options.baseDir, nextSession);
  } catch (error) {
    if (abortController.signal.aborted) {
      assistantMessage.status = "stopped";
      assistantMessage.pendingImage = false;
      assistantMessage.confirmImage = isDreamDraftMessage(assistantMessage);
      assistantMessage.content ||= "已停止。";
      nextSession = touchSession(session, [...existingMessages, userMessage, assistantMessage], titleFromMessage(options.request.message, options.fallbackTitle));
      return persistSession(options.baseDir, nextSession);
    }
    const message = error instanceof Error ? error.message : "请求失败，请稍后再试。";
    assistantMessage.status = "failed";
    assistantMessage.pendingImage = false;
    assistantMessage.content = message;
    nextSession = touchSession(session, [...existingMessages, userMessage, assistantMessage], titleFromMessage(options.request.message, options.fallbackTitle));
    await persistSession(options.baseDir, nextSession);
    throw new Error(message);
  } finally {
    options.abortControllers.delete(session.id);
  }
}

export async function runDreamConversation(options: RunOptions) {
  const session = await getSession(options.baseDir, options.request.sessionId, options.fallbackTitle);
  const existingMessages = truncateForRetry(session.messages, options.request.retryMessageId);
  const savedFiles = await saveInputFiles(options.baseDir, session.id, options.request.files);
  const userMessage = createMessage("user", options.request.message, savedFiles);
  const assistantMessage = createAssistantMessage(options.request.optimisticAssistantId);
  const messages = [...existingMessages, userMessage, assistantMessage];
  let nextSession = touchSession(session, messages, titleFromMessage(options.request.message, options.fallbackTitle));
  await persistSession(options.baseDir, nextSession);

  const abortController = new AbortController();
  options.abortControllers.set(session.id, abortController);
  options.event.sender.send(options.startChannel, { sessionId: session.id, messageId: assistantMessage.id });

  try {
    const completionInput = await completionMessages(options.systemPrompt, [...existingMessages, userMessage]);
    const timeout = withTimeoutSignal(abortController.signal, chatCompletionTimeoutMs, "绘梦聊天等待太久，已经自动停止。");
    try {
      let emitted = false;
      const content = ensureVisibleAssistantContent(await readDreamChatCompletion(completionInput, timeout.signal, (delta) => {
        emitted = true;
        assistantMessage.content += delta;
        options.event.sender.send(options.chunkChannel, { sessionId: session.id, messageId: assistantMessage.id, delta });
      }), options.fallbackTitle);
      assistantMessage.content = content;
      assistantMessage.confirmImage = isDreamDraftMessage(assistantMessage);
      if (!emitted) {
        options.event.sender.send(options.chunkChannel, { sessionId: session.id, messageId: assistantMessage.id, delta: content, replace: true });
      }
    } finally {
      timeout.cleanup();
    }
    assistantMessage.status = "done";
    assistantMessage.pendingImage = false;
    assistantMessage.confirmImage = isDreamDraftMessage(assistantMessage);
    nextSession = touchSession(session, [...existingMessages, userMessage, assistantMessage], titleFromMessage(options.request.message, options.fallbackTitle));
    return persistSession(options.baseDir, nextSession);
  } catch (error) {
    if (abortController.signal.aborted) {
      assistantMessage.status = "stopped";
      assistantMessage.pendingImage = false;
      assistantMessage.content ||= "已停止。";
      nextSession = touchSession(session, [...existingMessages, userMessage, assistantMessage], titleFromMessage(options.request.message, options.fallbackTitle));
      return persistSession(options.baseDir, nextSession);
    }
    const message = error instanceof Error ? error.message : "请求失败，请稍后再试。";
    assistantMessage.status = "failed";
    assistantMessage.pendingImage = false;
    assistantMessage.content = message;
    nextSession = touchSession(session, [...existingMessages, userMessage, assistantMessage], titleFromMessage(options.request.message, options.fallbackTitle));
    await persistSession(options.baseDir, nextSession);
    throw new Error(message);
  } finally {
    options.abortControllers.delete(session.id);
  }
}

export async function runHuayingConversation(options: RunOptions) {
  const session = await getSession(options.baseDir, options.request.sessionId, options.fallbackTitle);
  const existingMessages = truncateForRetry(session.messages, options.request.retryMessageId);
  const savedFiles = await saveInputFiles(options.baseDir, session.id, options.request.files);
  const userMessage = createMessage("user", options.request.message, savedFiles);
  const assistantMessage = createAssistantMessage(options.request.optimisticAssistantId, true);
  assistantMessage.content = "正在生成图片";
  assistantMessage.imageProgress = 8;
  assistantMessage.imageStage = "理解会话需求";
  const messages = [...existingMessages, userMessage, assistantMessage];
  let nextSession = touchSession(session, messages, titleFromMessage(options.request.message, options.fallbackTitle));
  await persistSession(options.baseDir, nextSession);

  const abortController = new AbortController();
  options.abortControllers.set(session.id, abortController);
  options.event.sender.send(options.startChannel, { sessionId: session.id, messageId: assistantMessage.id });

  const progressStages = [
    { progress: 18, stage: "理解会话需求" },
    { progress: 34, stage: "融合历史修改" },
    { progress: 52, stage: "整理画面提示" },
    { progress: 68, stage: "连接花映引擎" },
    { progress: 82, stage: "等待花映成图" },
    { progress: 92, stage: "继续守着画面" },
    { progress: 96, stage: "马上检查结果" }
  ];
  const progressStart = Date.now();
  const progressTimer = setInterval(() => {
    const elapsedSeconds = Math.max(1, (Date.now() - progressStart) / 1000);
    const earlyProgress = 8 + elapsedSeconds * 3.2;
    const lateProgress = 58 + (maxVisibleImageProgress - 58) * (1 - Math.exp(-(elapsedSeconds - 16) / 82));
    const targetProgress = Math.min(maxVisibleImageProgress, elapsedSeconds < 16 ? earlyProgress : lateProgress);
    const currentProgress = assistantMessage.imageProgress ?? 8;
    const visibleTick = currentProgress < 88 ? 0.85 : 0.24;
    assistantMessage.imageProgress = Math.min(maxVisibleImageProgress, Math.max(currentProgress + visibleTick, targetProgress));
    const stage = [...progressStages].reverse().find((item) => assistantMessage.imageProgress! >= item.progress) ?? progressStages[0];
    assistantMessage.imageStage = stage.stage;
    options.event.sender.send(options.chunkChannel, {
      sessionId: session.id,
      messageId: assistantMessage.id,
      delta: "",
      imageProgress: assistantMessage.imageProgress,
      imageStage: assistantMessage.imageStage
    });
  }, 1200);

  try {
    const prompt = huayingPrompt(existingMessages, userMessage);
    assistantMessage.imagePrompt = prompt;
    const previousImage = latestGeneratedImageFile(existingMessages);
    const currentImages = (options.request.files ?? []).filter((file) => file.mimeType.startsWith("image/"));
    const record = await generateImage({
      prompt,
      files: previousImage ? [previousImage, ...currentImages] : currentImages,
      signal: abortController.signal
    });
    assistantMessage.content = "生成好了，点图片可以放大查看。";
    assistantMessage.status = "done";
    assistantMessage.pendingImage = false;
    assistantMessage.imageProgress = 100;
    assistantMessage.imageStage = "生成完成";
    assistantMessage.imageUrl = record.imageUrl;
    assistantMessage.imagePrompt = record.prompt;
    options.event.sender.send(options.chunkChannel, {
      sessionId: session.id,
      messageId: assistantMessage.id,
      delta: assistantMessage.content,
      replace: true,
      imageUrl: record.imageUrl,
      imagePrompt: record.prompt,
      imageProgress: 100,
      imageStage: "生成完成",
      pendingImage: false,
      status: "done"
    });
    nextSession = touchSession(session, [...existingMessages, userMessage, assistantMessage], titleFromMessage(options.request.message, options.fallbackTitle));
    return persistSession(options.baseDir, nextSession);
  } catch (error) {
    if (abortController.signal.aborted) {
      assistantMessage.status = "stopped";
      assistantMessage.pendingImage = false;
      assistantMessage.content = "已停止。";
      assistantMessage.imageStage = "已停止";
      options.event.sender.send(options.chunkChannel, {
        sessionId: session.id,
        messageId: assistantMessage.id,
        delta: assistantMessage.content,
        replace: true,
        pendingImage: false,
        status: "stopped",
        imageStage: "已停止"
      });
      nextSession = touchSession(session, [...existingMessages, userMessage, assistantMessage], titleFromMessage(options.request.message, options.fallbackTitle));
      return persistSession(options.baseDir, nextSession);
    }
    const message = error instanceof Error ? error.message : "花映生成失败，请稍后再试。";
    assistantMessage.status = "failed";
    assistantMessage.pendingImage = false;
    assistantMessage.content = message;
    assistantMessage.imageStage = "生成失败";
    options.event.sender.send(options.chunkChannel, {
      sessionId: session.id,
      messageId: assistantMessage.id,
      delta: message,
      replace: true,
      pendingImage: false,
      status: "failed",
      imageStage: "生成失败"
    });
    nextSession = touchSession(session, [...existingMessages, userMessage, assistantMessage], titleFromMessage(options.request.message, options.fallbackTitle));
    await persistSession(options.baseDir, nextSession);
    throw new Error(message);
  } finally {
    clearInterval(progressTimer);
    options.abortControllers.delete(session.id);
  }
}
