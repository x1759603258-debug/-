import { ipcMain } from "electron";
import { createHuaying, deleteHuaying, listHuayings } from "../services/huayingHistoryStore.js";
import { runHuayingConversation } from "../services/conversationRunner.js";
import { huayingDir } from "../services/fileStore.js";
import type { ChatRequest } from "../../src/lib/desktopApi.js";

const huayingAbortControllers = new Map<string, AbortController>();
const huayingSystemPrompt = "花映会话式出图";

export function registerHuayingIpc() {
  ipcMain.handle("huayings:list", () => listHuayings());
  ipcMain.handle("huayings:create", () => createHuaying());
  ipcMain.handle("huayings:delete", (_event, sessionId: string) => deleteHuaying(sessionId));
  ipcMain.handle("huayings:send-stream", (event, request: ChatRequest) => runHuayingConversation({
    event,
    request,
    baseDir: huayingDir(),
    fallbackTitle: "新的花映",
    systemPrompt: huayingSystemPrompt,
    startChannel: "huayings:start",
    chunkChannel: "huayings:chunk",
    abortControllers: huayingAbortControllers
  }));
  ipcMain.handle("huayings:stop", (_event, sessionId: string) => {
    huayingAbortControllers.get(sessionId)?.abort();
  });
}
