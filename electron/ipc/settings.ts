import { app, ipcMain, shell } from "electron";
import { downloadAndInstallUpdate } from "../services/updateDownloader.js";
import { assertValidAccount } from "../../src/lib/accountValidation.js";
import type { AnnouncementInfo, AppSettings, AuthResult, FeedbackAttachment, PlatformStatus, TestConnectionResult, UpdateInfo } from "../../src/lib/desktopApi.js";
import { apiUrl, platformHeaders, platformUrl } from "../services/platformClient.js";
import { clearAuth, getSettings, saveAuth, saveSettings } from "../services/settingsStore.js";

async function testConnection(settings: AppSettings): Promise<TestConnectionResult> {
  try {
    const response = await fetch(apiUrl(settings.platformBaseUrl, "health"));
    if (!response.ok) throw new Error(`平台后端返回 ${response.status}`);
    return { ok: true, message: "小花园已经连上，可以开始轻语和绘梦。" };
  } catch (error) {
    return { ok: false, message: `小花园暂时没连上：${error instanceof Error ? error.message : String(error)}` };
  }
}

async function parseError(response: Response, fallback: string) {
  try {
    const data = await response.json() as { error?: { message?: string } | string; message?: string };
    if (typeof data.error === "string") return data.error;
    return data.error?.message ?? data.message ?? fallback;
  } catch {
    return await response.text() || fallback;
  }
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split(".").map((part) => Number(part.replace(/\D/g, "")) || 0);
  const rightParts = right.split(".").map((part) => Number(part.replace(/\D/g, "")) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

async function checkForUpdate(): Promise<UpdateInfo> {
  const settings = await getSettings();
  const currentVersion = app.getVersion();
  const response = await fetch(apiUrl(settings.platformBaseUrl, "updates/latest.json"), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`\u66f4\u65b0\u4fe1\u606f\u8bfb\u53d6\u5931\u8d25\uff1a${response.status}`);
  }

  const latest = await response.json() as Partial<UpdateInfo>;
  const latestVersion = String(latest.latestVersion || currentVersion);
  const releaseNotes = typeof latest.releaseNotes === "string"
    ? latest.releaseNotes.replace(/\\n/g, "\n")
    : undefined;

  return {
    currentVersion,
    latestVersion,
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    releaseTitle: typeof latest.releaseTitle === "string" ? latest.releaseTitle : undefined,
    downloadUrl: latest.downloadUrl,
    releaseNotes,
    forceUpdate: latest.forceUpdate === true,
    sizeBytes: latest.sizeBytes,
    sha256: latest.sha256,
    publishedAt: latest.publishedAt
  };
}

function normalizeAnnouncement(raw: Partial<AnnouncementInfo>): AnnouncementInfo {
  const mode = raw.mode === "banner" || raw.mode === "modal" ? raw.mode : "toast";
  const durationMs = Math.max(2500, Math.min(60_000, Number(raw.durationMs ?? 6000)));
  return {
    enabled: raw.enabled === true,
    id: typeof raw.id === "string" ? raw.id : undefined,
    title: typeof raw.title === "string" ? raw.title : "\u665a\u85b0\u516c\u544a",
    content: typeof raw.content === "string" ? raw.content : "",
    mode,
    durationMs,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined
  };
}

async function getAnnouncement(): Promise<AnnouncementInfo> {
  const settings = await getSettings();
  const response = await fetch(apiUrl(settings.platformBaseUrl, "announcements/latest.json"), { cache: "no-store" });
  if (!response.ok) {
    return { enabled: false };
  }
  const latest = await response.json() as Partial<AnnouncementInfo>;
  return normalizeAnnouncement(latest);
}

async function submitFeedback(content: string, attachments: FeedbackAttachment[] = []) {
  const response = await fetch(await platformUrl("feedback"), {
    method: "POST",
    headers: await platformHeaders(),
    body: JSON.stringify({ content, attachments })
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "反馈发送失败。"));
  }
  return response.json();
}

function fallbackStatus(settings: AppSettings): PlatformStatus {
  return {
    deviceId: settings.deviceId,
    mode: settings.authToken ? "user" : "guest",
    isLoggedIn: Boolean(settings.authToken),
    username: settings.username,
    isMember: false,
    memberQuotaMode: undefined,
    memberChatLimit: undefined,
    memberImageLimit: undefined,
    guestChatLeft: settings.authToken ? 0 : 20,
    guestImageLeft: settings.authToken ? 0 : 1,
    trialChatLeft: settings.authToken ? 30 : 0,
    trialImageLeft: settings.authToken ? 1 : 0,
    dailyChatLeft: 0,
    dailyImageLeft: 0,
    canCheckin: Boolean(settings.authToken),
    checkinChatBonus: 0,
    checkinImageBonus: 0,
    bonusChatLeft: 0,
    bonusImageLeft: 0,
    checkinCycleDay: 0,
    nextCheckinDay: 1,
    checkinTodayChatReward: 10,
    checkinTodayImageReward: 0,
    checkinTodayChatRewardMin: 1,
    checkinTodayChatRewardMax: 10,
    checkinTodayRandomChat: true,
    checkinPlan: [
      { day: 1, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
      { day: 2, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
      { day: 3, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
      { day: 4, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
      { day: 5, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
      { day: 6, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
      { day: 7, chat: 30, image: 1, randomChat: false, chatMin: 30, chatMax: 30 }
    ],
    blocked: false
  };
}

export async function getPlatformStatusAuthoritative(): Promise<PlatformStatus> {
  const settings = await getSettings();
  try {
    const response = await fetch(await platformUrl("me"), { headers: await platformHeaders() });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json() as PlatformStatus;
    if (settings.authToken && !data.isLoggedIn) {
      await clearAuth();
      return data;
    }
    return {
      ...data,
      isLoggedIn: data.isLoggedIn,
      username: settings.username ?? data.username,
      mode: data.mode
    };
  } catch {
    return fallbackStatus(settings);
  }
}

async function authRequest(endpoint: string, username: string, password: string): Promise<AuthResult> {
  if (endpoint === "auth/register") {
    assertValidAccount(username, password);
  }
  const cleanUsername = username.trim();
  const response = await fetch(await platformUrl(endpoint), {
    method: "POST",
    headers: await platformHeaders(),
    body: JSON.stringify({ username: cleanUsername, password })
  });
  if (!response.ok) throw new Error(await parseError(response, "账号请求失败。"));
  const data = await response.json() as AuthResult;
  await saveAuth(data.token, data.username);
  return data;
}

export function registerSettingsIpc() {
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:save", (_event, settings: AppSettings) => saveSettings(settings));
  ipcMain.handle("settings:test", (_event, settings: AppSettings) => testConnection(settings));
  ipcMain.handle("shell:open-external", (_event, url: string) => {
    if (!/^https:\/\/qm\.qq\.com\/q\/[A-Za-z0-9]+$/i.test(url)) {
      throw new Error("不支持打开这个链接。");
    }
    return shell.openExternal(url);
  });
  ipcMain.handle("updates:open-download", (_event, url: string, sha256?: string) => {
    if (!/^http:\/\/185\.255\.95\.140:8888\/downloads\/[^?#]+$/i.test(url)) {
      throw new Error("\u53ea\u80fd\u4e0b\u8f7d\u5b98\u65b9\u66f4\u65b0\u94fe\u63a5\u3002");
    }
    return downloadAndInstallUpdate(url, sha256);
  });
  ipcMain.handle("announcements:latest", () => getAnnouncement());
  ipcMain.handle("feedback:submit", (_event, content: string, attachments?: FeedbackAttachment[]) => submitFeedback(content, attachments));
  ipcMain.handle("updates:check", () => checkForUpdate());
  ipcMain.handle("auth:register", (_event, username: string, password: string) => authRequest("auth/register", username, password));
  ipcMain.handle("auth:login", (_event, username: string, password: string) => authRequest("auth/login", username, password));
  ipcMain.handle("auth:logout", async () => {
    const settings = await getSettings();
    await clearAuth();
    try {
      const response = await fetch(apiUrl(settings.platformBaseUrl, "auth/logout"), {
        method: "POST",
        headers: { "X-Device-Id": settings.deviceId }
      });
      if (response.ok) return response.json() as Promise<PlatformStatus>;
    } catch {
      // 本地登录信息已清除；后端不可用时保持游客态回退。
    }
    return fallbackStatus({ ...settings, authToken: undefined, username: undefined });
  });
  ipcMain.handle("platform:status", () => getPlatformStatusAuthoritative());
  ipcMain.handle("platform:activate", async (_event, code: string) => {
    const response = await fetch(await platformUrl("license/activate"), {
      method: "POST",
      headers: await platformHeaders(),
      body: JSON.stringify({ code })
    });
    const data = await response.json() as PlatformStatus;
    if (!response.ok) throw new Error(await parseError(response, "花钥匙暂时没有打开花园。"));
    const settings = await getSettings();
    await saveSettings({ ...settings, licenseCode: code });
    return getPlatformStatusAuthoritative();
  });
  ipcMain.handle("platform:checkin", async () => {
    const settings = await getSettings();
    if (!settings.authToken) throw new Error("登录后才能签到。");
    const { "Content-Type": _contentType, ...headers } = await platformHeaders();
    const response = await fetch(await platformUrl("checkin"), {
      method: "POST",
      headers
    });
    if (!response.ok) throw new Error(await parseError(response, "签到失败。"));
    return response.json() as Promise<PlatformStatus>;
  });
}
