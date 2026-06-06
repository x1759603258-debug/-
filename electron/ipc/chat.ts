import { ipcMain } from "electron";
import { createChat, deleteChat, listChats } from "../services/chatHistoryStore.js";
import { chatDir } from "../services/fileStore.js";
import { runChatConversation } from "../services/conversationRunner.js";
import type { ChatRequest } from "../../src/lib/desktopApi.js";

const chatAbortControllers = new Map<string, AbortController>();
const chatSystemPrompt = [
  "你是晚薰里的轻语助手，提供高质量聊天体验。",
  "用自然、清晰、温柔但不啰嗦的中文回答用户。",
  "用户可以拖入图片、文档和表格；如果有图片，认真分析画面主体、文字、风格、细节和用户问题；如果有文件，先基于可读取的内容和摘要回答。",
  "不编造无法读取的细节；对缺失信息要直接说明，并给出下一步建议。"
].join("\n");

export function registerChatIpc() {
  ipcMain.handle("chats:list", () => listChats());
  ipcMain.handle("chats:create", () => createChat());
  ipcMain.handle("chats:delete", (_event, sessionId: string) => deleteChat(sessionId));
  ipcMain.handle("chats:send", (event, request: ChatRequest) => runChatConversation({
    event,
    request,
    baseDir: chatDir(),
    fallbackTitle: "新的轻语",
    systemPrompt: chatSystemPrompt,
    startChannel: "chats:start",
    chunkChannel: "chats:chunk",
    abortControllers: chatAbortControllers
  }));
  ipcMain.handle("chats:send-stream", (event, request: ChatRequest) => runChatConversation({
    event,
    request,
    baseDir: chatDir(),
    fallbackTitle: "新的轻语",
    systemPrompt: chatSystemPrompt,
    startChannel: "chats:start",
    chunkChannel: "chats:chunk",
    abortControllers: chatAbortControllers
  }));
  ipcMain.handle("chats:stop", (_event, sessionId: string) => {
    chatAbortControllers.get(sessionId)?.abort();
  });
}
