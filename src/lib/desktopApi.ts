export { fixedPlatformSettings } from "./platformDefaults.js";

export type ChatRole = "system" | "user" | "assistant";

export interface MessageFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "document" | "sheet" | "file";
  localPath?: string;
  dataUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  files?: MessageFile[];
  imageUrl?: string;
  imagePrompt?: string;
  pendingImage?: boolean;
  confirmImage?: boolean;
  imageSourceMessageId?: string;
  imageProgress?: number;
  imageStage?: string;
  status?: "pending" | "done" | "failed" | "stopped";
  retryMessageId?: string;
  error?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ImageRecord {
  id: string;
  prompt: string;
  model: string;
  size: string;
  imageUrl?: string;
  localPath?: string;
  createdAt: string;
}

export interface SaveImageResult {
  saved: boolean;
  record: ImageRecord;
  localPath?: string;
}

export interface AppSettings {
  platformBaseUrl: string;
  deviceId: string;
  licenseCode?: string;
  authToken?: string;
  username?: string;
  chatModel: string;
  imageModel: string;
  stream: boolean;
}

export type AccountMode = "guest" | "user" | "member";
export type MemberPlan = "one_day" | "three_day" | "week" | "fvip";
export type MemberQuotaMode = "period" | "daily" | "unlimited";

export interface PlatformStatus {
  deviceId: string;
  mode: AccountMode;
  displayName?: "游客" | "旅人" | "三天会员" | "七天会员" | "无限制 FVIP";
  isLoggedIn: boolean;
  username?: string;
  isMember: boolean;
  memberPlan?: MemberPlan;
  memberQuotaMode?: MemberQuotaMode;
  memberChatLimit?: number;
  memberImageLimit?: number;
  memberExpiresAt?: string;
  guestChatLeft: number;
  guestImageLeft: number;
  trialChatLeft: number;
  trialImageLeft: number;
  dailyChatLeft: number;
  dailyImageLeft: number;
  canCheckin: boolean;
  lastCheckinDate?: string;
  checkinChatBonus: number;
  checkinImageBonus?: number;
  bonusChatLeft?: number;
  bonusImageLeft?: number;
  checkinCycleDay?: number;
  nextCheckinDay?: number;
  checkinTodayChatReward?: number;
  checkinTodayImageReward?: number;
  checkinTodayChatRewardMin?: number;
  checkinTodayChatRewardMax?: number;
  checkinTodayRandomChat?: boolean;
  lastCheckinReward?: { day: number; chat: number; image: number };
  checkinPlan?: Array<{ day: number; chat: number; image: number; randomChat?: boolean; chatMin?: number; chatMax?: number }>;
  blocked: boolean;
}

export function availableChatQuota(status?: PlatformStatus) {
  if (!status) return undefined;
  if (status.isMember) return status.dailyChatLeft;
  if (status.isLoggedIn) return status.trialChatLeft;
  return status.guestChatLeft;
}

export function availableImageQuota(status?: PlatformStatus) {
  if (!status) return undefined;
  if (status.isMember) return status.dailyImageLeft;
  if (status.isLoggedIn) return status.trialImageLeft;
  return status.guestImageLeft;
}

export function quotaText(value?: number) {
  if (value === undefined) return "--";
  return value >= Number.MAX_SAFE_INTEGER ? "无限" : String(value);
}

export const chatQuotaEmptyMessage = "今天的轻语次数用完啦，可以注册账号、签到或使用花钥匙获得更多次数。";
export const imageQuotaEmptyMessage = "今天的花映次数用完啦，可以注册账号、签到或使用花钥匙获得更多次数。";

export interface AuthResult {
  token: string;
  username: string;
  message?: string;
  status: PlatformStatus;
}

export interface AttachmentInput {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export interface ChatRequest {
  sessionId?: string;
  message: string;
  files?: AttachmentInput[];
  retryMessageId?: string;
  optimisticAssistantId?: string;
}

export interface StreamStartPayload {
  sessionId: string;
  messageId: string;
}

export interface StreamChunkPayload extends StreamStartPayload {
  delta: string;
  replace?: boolean;
  imageUrl?: string;
  imagePrompt?: string;
  imageProgress?: number;
  imageStage?: string;
  pendingImage?: boolean;
  status?: ChatMessage["status"];
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseTitle?: string;
  downloadUrl?: string;
  releaseNotes?: string;
  forceUpdate?: boolean;
  sizeBytes?: number;
  sha256?: string;
  publishedAt?: string;
}

export interface AnnouncementInfo {
  enabled?: boolean;
  id?: string;
  title?: string;
  content?: string;
  mode?: "toast" | "banner" | "modal";
  durationMs?: number;
  updatedAt?: string;
}

export interface FeedbackAttachment {
  id?: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export interface FeedbackSubmitResult {
  ok: boolean;
  feedback?: {
    id: string;
    deviceId: string;
    username?: string;
    content: string;
    attachments?: FeedbackAttachment[];
    status: "open" | "closed";
    createdAt: string;
    updatedAt: string;
  };
}

export interface GardenApi {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  testConnection: (settings: AppSettings) => Promise<TestConnectionResult>;
  openExternal: (url: string) => Promise<void>;
  checkForUpdate: () => Promise<UpdateInfo>;
  openUpdateDownload: (url: string, sha256?: string) => Promise<void>;
  getAnnouncement: () => Promise<AnnouncementInfo>;
  submitFeedback: (content: string, attachments?: FeedbackAttachment[]) => Promise<FeedbackSubmitResult>;
  getPlatformStatus: () => Promise<PlatformStatus>;
  registerAccount: (username: string, password: string) => Promise<AuthResult>;
  loginAccount: (username: string, password: string) => Promise<AuthResult>;
  logoutAccount: () => Promise<PlatformStatus>;
  activateLicense: (code: string) => Promise<PlatformStatus>;
  checkin: () => Promise<PlatformStatus>;
  listChats: () => Promise<ChatSession[]>;
  createChat: () => Promise<ChatSession>;
  deleteChat: (sessionId: string) => Promise<void>;
  sendChatMessage: (request: ChatRequest) => Promise<ChatSession>;
  sendChatMessageStream: (request: ChatRequest) => Promise<ChatSession>;
  stopChat: (sessionId: string) => Promise<void>;
  onChatStart: (callback: (payload: StreamStartPayload) => void) => () => void;
  onChatChunk: (callback: (payload: StreamChunkPayload) => void) => () => void;
  listDreams: () => Promise<ChatSession[]>;
  createDream: () => Promise<ChatSession>;
  deleteDream: (sessionId: string) => Promise<void>;
  sendDreamMessageStream: (request: ChatRequest) => Promise<ChatSession>;
  stopDream: (sessionId: string) => Promise<void>;
  onDreamStart: (callback: (payload: StreamStartPayload) => void) => () => void;
  onDreamChunk: (callback: (payload: StreamChunkPayload) => void) => () => void;
  listHuayings: () => Promise<ChatSession[]>;
  createHuaying: () => Promise<ChatSession>;
  deleteHuaying: (sessionId: string) => Promise<void>;
  sendHuayingMessageStream: (request: ChatRequest) => Promise<ChatSession>;
  stopHuaying: (sessionId: string) => Promise<void>;
  onHuayingStart: (callback: (payload: StreamStartPayload) => void) => () => void;
  onHuayingChunk: (callback: (payload: StreamChunkPayload) => void) => () => void;
  saveImage: (record: ImageRecord) => Promise<SaveImageResult>;
}

const globalApi = window as Window & { gardenApi?: GardenApi };

if (!globalApi.gardenApi) {
  throw new Error("Electron preload 未加载：window.gardenApi 不存在。请从晚薰 Electron 窗口启动，不支持浏览器预览。 ");
}

export const gardenApi: GardenApi = globalApi.gardenApi;
