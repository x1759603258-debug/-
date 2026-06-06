import type { ChatSession, StreamChunkPayload } from "./desktopApi";

export function friendlyUiError(error: unknown, fallback = "发送失败，请稍后再试。") {
  const raw = error instanceof Error ? error.message : String(error || "");
  let detail = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    detail = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message ?? raw;
  } catch {
    detail = raw;
  }
  const cleaned = detail
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
  if (/Failed to fetch|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|NetworkError/i.test(cleaned)) {
    return "小花园暂时没连上，请稍后再试。";
  }
  return cleaned || fallback;
}

export function appendChunkToSession(session: ChatSession, chunk: StreamChunkPayload, text: string): ChatSession {
  if (session.id !== chunk.sessionId) return session;
  return {
    ...session,
    messages: session.messages.map((message) => message.id === chunk.messageId ? {
      ...message,
      content: chunk.replace ? text : message.content + text,
      imageUrl: chunk.imageUrl ?? message.imageUrl,
      imagePrompt: chunk.imagePrompt ?? message.imagePrompt,
      imageProgress: chunk.imageProgress ?? message.imageProgress,
      imageStage: chunk.imageStage ?? message.imageStage,
      pendingImage: chunk.pendingImage ?? message.pendingImage,
      status: chunk.status ?? message.status
    } : message)
  };
}

export function markAssistantFailed(session: ChatSession, assistantId: string | undefined, content: string): ChatSession {
  if (!assistantId) return session;
  return {
    ...session,
    messages: session.messages.map((message) => message.id === assistantId ? { ...message, content, status: "failed", pendingImage: false } : message),
    updatedAt: new Date().toISOString()
  };
}
