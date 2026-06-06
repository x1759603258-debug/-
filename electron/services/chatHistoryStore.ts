import type { ChatSession } from "../../src/lib/desktopApi.js";
import { chatDir } from "./fileStore.js";
import { createMessage, createSession, deleteSession, listSessions, upsertSession } from "./sessionStore.js";

export async function listChats(): Promise<ChatSession[]> {
  return listSessions(chatDir());
}

export async function createChat(): Promise<ChatSession> {
  return createSession(chatDir(), "新的轻语");
}

export async function deleteChat(sessionId: string): Promise<void> {
  return deleteSession(chatDir(), sessionId);
}

export async function upsertChat(session: ChatSession): Promise<ChatSession> {
  return upsertSession(chatDir(), session);
}

export { createMessage };
