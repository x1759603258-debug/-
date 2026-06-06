import { contextBridge, ipcRenderer } from "electron";

const api = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  testConnection: (settings) => ipcRenderer.invoke("settings:test", settings),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  checkForUpdate: () => ipcRenderer.invoke("updates:check"),
  openUpdateDownload: (url, sha256) => ipcRenderer.invoke("updates:open-download", url, sha256),
  getAnnouncement: () => ipcRenderer.invoke("announcements:latest"),
  submitFeedback: (content, attachments) => ipcRenderer.invoke("feedback:submit", content, attachments),
  registerAccount: (username, password) => ipcRenderer.invoke("auth:register", username, password),
  loginAccount: (username, password) => ipcRenderer.invoke("auth:login", username, password),
  logoutAccount: () => ipcRenderer.invoke("auth:logout"),
  getPlatformStatus: () => ipcRenderer.invoke("platform:status"),
  activateLicense: (code) => ipcRenderer.invoke("platform:activate", code),
  checkin: () => ipcRenderer.invoke("platform:checkin"),
  listChats: () => ipcRenderer.invoke("chats:list"),
  createChat: () => ipcRenderer.invoke("chats:create"),
  deleteChat: (sessionId) => ipcRenderer.invoke("chats:delete", sessionId),
  sendChatMessage: (request) => ipcRenderer.invoke("chats:send", request),
  sendChatMessageStream: (request) => ipcRenderer.invoke("chats:send-stream", request),
  stopChat: (sessionId) => ipcRenderer.invoke("chats:stop", sessionId),
  onChatStart: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("chats:start", listener);
    return () => ipcRenderer.removeListener("chats:start", listener);
  },
  onChatChunk: (callback) => {
    const listener = (_event, chunk) => callback(chunk);
    ipcRenderer.on("chats:chunk", listener);
    return () => ipcRenderer.removeListener("chats:chunk", listener);
  },
  onDreamStart: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("dreams:start", listener);
    return () => ipcRenderer.removeListener("dreams:start", listener);
  },
  onDreamChunk: (callback) => {
    const listener = (_event, chunk) => callback(chunk);
    ipcRenderer.on("dreams:chunk", listener);
    return () => ipcRenderer.removeListener("dreams:chunk", listener);
  },
  listDreams: () => ipcRenderer.invoke("dreams:list"),
  createDream: () => ipcRenderer.invoke("dreams:create"),
  deleteDream: (sessionId) => ipcRenderer.invoke("dreams:delete", sessionId),
  sendDreamMessageStream: (request) => ipcRenderer.invoke("dreams:send-stream", request),
  stopDream: (sessionId) => ipcRenderer.invoke("dreams:stop", sessionId),
  listHuayings: () => ipcRenderer.invoke("huayings:list"),
  createHuaying: () => ipcRenderer.invoke("huayings:create"),
  deleteHuaying: (sessionId) => ipcRenderer.invoke("huayings:delete", sessionId),
  sendHuayingMessageStream: (request) => ipcRenderer.invoke("huayings:send-stream", request),
  stopHuaying: (sessionId) => ipcRenderer.invoke("huayings:stop", sessionId),
  onHuayingStart: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("huayings:start", listener);
    return () => ipcRenderer.removeListener("huayings:start", listener);
  },
  onHuayingChunk: (callback) => {
    const listener = (_event, chunk) => callback(chunk);
    ipcRenderer.on("huayings:chunk", listener);
    return () => ipcRenderer.removeListener("huayings:chunk", listener);
  },
  saveImage: (record) => ipcRenderer.invoke("images:save", record)
};

contextBridge.exposeInMainWorld("gardenApi", api);
