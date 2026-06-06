import type { AttachmentInput, ChatMessage, ChatSession } from "./desktopApi";

export interface PendingRequest {
  sessionId: string;
  message: string;
  files: AttachmentInput[];
  optimisticAssistantId: string;
}

interface OptimisticOptions {
  fallbackTitle: string;
  pendingImage?: boolean;
  pendingImageText?: string;
}

function optimisticMessage(role: ChatMessage["role"], content: string, files?: AttachmentInput[], pendingImage = false): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    files: files?.map((file) => ({
      ...file,
      id: crypto.randomUUID(),
      kind: file.mimeType.startsWith("image/") ? "image" : "file"
    })),
    createdAt: new Date().toISOString(),
    pendingImage,
    status: role === "assistant" ? "pending" : undefined
  };
}

export function createFallbackSession(title: string): ChatSession {
  const createdAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    messages: [],
    createdAt,
    updatedAt: createdAt
  };
}

export function createOptimisticSession(
  base: ChatSession,
  message: string,
  files: AttachmentInput[],
  options: OptimisticOptions,
  retryMessageId?: string
): { session: ChatSession; assistantId: string } {
  const assistant = optimisticMessage(
    "assistant",
    options.pendingImage ? options.pendingImageText ?? "正在生成图片" : "",
    undefined,
    options.pendingImage
  );
  const retryIndex = retryMessageId ? base.messages.findIndex((item) => item.id === retryMessageId) : -1;
  const messages = retryIndex >= 0
    ? base.messages.slice(0, retryIndex)
    : [...base.messages, optimisticMessage("user", message, files)];

  return {
    session: {
      ...base,
      title: base.messages.length ? base.title : message.slice(0, 18) || options.fallbackTitle,
      messages: [...messages, assistant],
      updatedAt: new Date().toISOString()
    },
    assistantId: assistant.id
  };
}

export function mergeSessions(existing: ChatSession[], incoming: ChatSession[]) {
  const byId = new Map<string, ChatSession>();
  for (const session of existing) byId.set(session.id, session);
  for (const session of incoming) byId.set(session.id, session);
  return Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function removePendingPair(session: ChatSession, request?: PendingRequest) {
  let removedUser = false;
  const messages = [...session.messages].reverse().filter((message) => {
    if (message.id === request?.optimisticAssistantId || message.status === "pending") return false;
    if (!removedUser && request && message.role === "user" && message.content === request.message) {
      removedUser = true;
      return false;
    }
    return true;
  }).reverse();
  return { ...session, messages, updatedAt: new Date().toISOString() };
}

export function userMessageForRetry(session: ChatSession | undefined, assistant: ChatMessage) {
  if (!session) return undefined;
  const index = session.messages.findIndex((message) => message.id === assistant.id);
  for (let i = index - 1; i >= 0; i -= 1) {
    const message = session.messages[i];
    if (message.role === "user") return message;
  }
  return undefined;
}

export function retryFilesFromMessage(message: ChatMessage) {
  return message.files
    ?.map((file) => ({ name: file.name, mimeType: file.mimeType, size: file.size, dataUrl: file.dataUrl ?? "" }))
    .filter((file) => file.dataUrl) ?? [];
}
