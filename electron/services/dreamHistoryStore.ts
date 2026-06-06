import type { ChatSession } from "../../src/lib/desktopApi.js";
import { dreamDir } from "./fileStore.js";
import { createSession, deleteSession, listSessions, upsertSession } from "./sessionStore.js";

export async function listDreams(): Promise<ChatSession[]> {
  return listSessions(dreamDir());
}

export async function createDream(): Promise<ChatSession> {
  return createSession(dreamDir(), "新的绘梦");
}

export async function deleteDream(sessionId: string): Promise<void> {
  return deleteSession(dreamDir(), sessionId);
}

export async function upsertDream(session: ChatSession): Promise<ChatSession> {
  return upsertSession(dreamDir(), session);
}
