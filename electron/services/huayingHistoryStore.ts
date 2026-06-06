import type { ChatSession } from "../../src/lib/desktopApi.js";
import { huayingDir } from "./fileStore.js";
import { createSession, deleteSession, listSessions, upsertSession } from "./sessionStore.js";

export async function listHuayings(): Promise<ChatSession[]> {
  return listSessions(huayingDir());
}

export async function createHuaying(): Promise<ChatSession> {
  return createSession(huayingDir(), "新的花映");
}

export async function deleteHuaying(sessionId: string): Promise<void> {
  return deleteSession(huayingDir(), sessionId);
}

export async function upsertHuaying(session: ChatSession): Promise<ChatSession> {
  return upsertSession(huayingDir(), session);
}
