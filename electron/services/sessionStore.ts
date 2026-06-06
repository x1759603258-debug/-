import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AttachmentInput, ChatMessage, ChatSession, MessageFile } from "../../src/lib/desktopApi.js";

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const metaFile = (sessionDir: string) => path.join(sessionDir, "messages.json");
const maxSessionJsonBytes = 48 * 1024 * 1024;

function fileKind(mimeType: string, name: string): MessageFile["kind"] {
  const lower = name.toLowerCase();
  if (mimeType.startsWith("image/")) return "image";
  if (lower.endsWith(".csv") || lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "sheet";
  if (mimeType.includes("pdf") || lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".doc") || lower.endsWith(".docx")) return "document";
  return "file";
}

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

async function readSession(sessionDir: string): Promise<ChatSession | undefined> {
  try {
    const file = metaFile(sessionDir);
    const info = await stat(file);
    if (info.size > maxSessionJsonBytes) return undefined;
    return normalizeSession(JSON.parse(await readFile(file, "utf-8")) as ChatSession);
  } catch {
    return undefined;
  }
}

async function writeSession(baseDir: string, session: ChatSession) {
  const sessionDir = path.join(baseDir, session.id);
  await mkdir(sessionDir, { recursive: true });
  const file = metaFile(sessionDir);
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, JSON.stringify(session, null, 2), "utf-8");
  try {
    await rename(tempFile, file);
  } catch {
    await rm(file, { force: true });
    await rename(tempFile, file);
  }
}

function normalizeSession(session: ChatSession): ChatSession {
  return {
    ...session,
    messages: session.messages.map((message) => {
      if (message.status !== "pending") return message;
      return {
        ...message,
        status: "failed",
        pendingImage: false,
        content: message.content || "上次生成未完成。"
      };
    })
  };
}

export async function listSessions(baseDir: string): Promise<ChatSession[]> {
  await mkdir(baseDir, { recursive: true });
  const entries = await readdir(baseDir, { withFileTypes: true });
  const sessions = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readSession(path.join(baseDir, entry.name))));
  return sessions.filter((session): session is ChatSession => Boolean(session)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createSession(baseDir: string, title: string, sessionId?: string): Promise<ChatSession> {
  const createdAt = now();
  const session: ChatSession = {
    id: sessionId || id(),
    title,
    messages: [],
    createdAt,
    updatedAt: createdAt
  };
  await writeSession(baseDir, session);
  return session;
}

export async function getSession(baseDir: string, sessionId?: string, fallbackTitle = "新的轻语") {
  const sessions = await listSessions(baseDir);
  const existing = sessions.find((session) => session.id === sessionId);
  return existing ?? createSession(baseDir, fallbackTitle, sessionId);
}

export async function upsertSession(baseDir: string, session: ChatSession): Promise<ChatSession> {
  await writeSession(baseDir, session);
  return session;
}

export async function deleteSession(baseDir: string, sessionId: string): Promise<void> {
  await rm(path.join(baseDir, sessionId), { recursive: true, force: true });
}

export async function saveInputFiles(baseDir: string, sessionId: string, files: AttachmentInput[] = []): Promise<MessageFile[]> {
  if (!files.length) return [];
  const filesDir = path.join(baseDir, sessionId, "files");
  await mkdir(filesDir, { recursive: true });
  return Promise.all(files.map(async (file) => {
    const fileId = id();
    const extName = path.extname(file.name);
    const fileName = `${fileId}${extName || `-${safeName(file.name)}`}`;
    const filePath = path.join(filesDir, fileName);
    const base64 = file.dataUrl.includes(",") ? file.dataUrl.split(",").pop() ?? "" : file.dataUrl;
    await writeFile(filePath, Buffer.from(base64, "base64"));
    return {
      id: fileId,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      kind: fileKind(file.mimeType, file.name),
      localPath: filePath,
      dataUrl: file.mimeType.startsWith("image/") ? file.dataUrl : undefined
    };
  }));
}

export function createMessage(role: ChatMessage["role"], content: string, files?: MessageFile[]): ChatMessage {
  return {
    id: id(),
    role,
    content,
    files: files?.length ? files : undefined,
    createdAt: now()
  };
}

export function touchSession(session: ChatSession, messages: ChatMessage[], title?: string): ChatSession {
  const updatedAt = now();
  return {
    ...session,
    title: session.messages.length ? session.title : title ?? session.title,
    messages,
    updatedAt
  };
}
