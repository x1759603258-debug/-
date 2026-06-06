import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type UsageType = "chat" | "image";
export type Plan = "one_day" | "three_day" | "week" | "fvip";
export type MemberQuotaMode = "period" | "daily" | "unlimited";
export type AccountMode = "guest" | "user" | "member";

export interface DeviceRecord {
  deviceId: string;
  createdAt: string;
  guestChatLimit?: number;
  guestImageLimit?: number;
  guestChatUsed?: number;
  guestImageUsed?: number;
  trialChatLimit: number;
  trialImageLimit: number;
  trialChatUsed: number;
  trialImageUsed: number;
  memberPlan?: Plan;
  memberQuotaMode?: MemberQuotaMode;
  memberExpiresAt?: string;
  dailyChatLimit?: number;
  dailyImageLimit?: number;
  dailyChatUsed: number;
  dailyImageUsed: number;
  memberCarryChatLimit?: number;
  memberCarryImageLimit?: number;
  memberCarryChatUsed?: number;
  memberCarryImageUsed?: number;
  checkinChatBonus: number;
  checkinImageBonus?: number;
  lastCheckinDate?: string;
  checkinCycleDay?: number;
  lastUsageDate: string;
  blocked?: boolean;
  threeDayTrialUsed?: boolean;
}

export interface LicenseRecord {
  code: string;
  plan: Plan;
  quotaMode?: MemberQuotaMode;
  expiresDays?: number;
  dailyChatLimit: number;
  dailyImageLimit: number;
  usedByDeviceId?: string;
  activatedAt?: string;
  expiresAt?: string;
  blocked?: boolean;
  createdAt: string;
}

export interface AccountRecord {
  username: string;
  passwordHash: string;
  token: string;
  deviceId: string;
  pendingChatBonus?: number;
  pendingImageBonus?: number;
  pendingMemberDays?: number;
  pendingFvip?: boolean;
  threeDayTrialUsed?: boolean;
  createdAt: string;
}

export interface UsageLog {
  id: string;
  deviceId: string;
  type: UsageType;
  model?: string;
  success: boolean;
  createdAt: string;
  message?: string;
}

export interface AnnouncementRecord {
  enabled: boolean;
  id?: string;
  title: string;
  content: string;
  mode: "toast" | "banner" | "modal";
  durationMs: number;
  updatedAt: string;
}

export interface FeedbackRecord {
  id: string;
  deviceId: string;
  username?: string;
  content: string;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
}

interface StoreData {
  devices: Record<string, DeviceRecord>;
  licenses: Record<string, LicenseRecord>;
  accounts: Record<string, AccountRecord>;
  usageLogs: UsageLog[];
  announcement?: AnnouncementRecord;
  feedbacks: FeedbackRecord[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storePath = process.env.GARDEN_STORE_PATH
  ? path.resolve(process.env.GARDEN_STORE_PATH)
  : path.resolve(__dirname, "../../data/store.json");
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const GUEST_CHAT_LIMIT = 20;
const GUEST_IMAGE_LIMIT = 1;
const TRIAL_CHAT_LIMIT = 50;
const TRIAL_IMAGE_LIMIT = 2;
const ONE_DAY_BONUS_CHAT_LIMIT = 100;
const ONE_DAY_BONUS_IMAGE_LIMIT = 3;
const THREE_DAY_PERIOD_CHAT_LIMIT = 180;
const THREE_DAY_PERIOD_IMAGE_LIMIT = 8;
const WEEK_DAILY_CHAT_LIMIT = 120;
const WEEK_DAILY_IMAGE_LIMIT = 5;

function isPromoQuotaActive() {
  const promoEndAtMs = Date.parse(process.env.PROMO_QUOTA_END_AT || "2026-06-12T16:00:00.000Z");
  return Number.isFinite(promoEndAtMs) && Date.now() < promoEndAtMs;
}

function accountQuotaDefaults() {
  return isPromoQuotaActive()
    ? { chat: 100, image: 5 }
    : { chat: TRIAL_CHAT_LIMIT, image: TRIAL_IMAGE_LIMIT };
}

function memberQuotaDefaults(plan: Plan) {
  if (plan === "one_day") {
    return {
      expiresDays: 1,
      dailyChatLimit: ONE_DAY_BONUS_CHAT_LIMIT,
      dailyImageLimit: ONE_DAY_BONUS_IMAGE_LIMIT,
      quotaMode: "period" as const
    };
  }
  if (plan === "three_day") {
    return {
      expiresDays: 3,
      dailyChatLimit: isPromoQuotaActive() ? 200 : THREE_DAY_PERIOD_CHAT_LIMIT,
      dailyImageLimit: THREE_DAY_PERIOD_IMAGE_LIMIT,
      quotaMode: "period" as const
    };
  }
  if (plan === "week") {
    return {
      expiresDays: 7,
      dailyChatLimit: isPromoQuotaActive() ? 220 : WEEK_DAILY_CHAT_LIMIT,
      dailyImageLimit: isPromoQuotaActive() ? 10 : WEEK_DAILY_IMAGE_LIMIT,
      quotaMode: "daily" as const
    };
  }
  return {
    expiresDays: undefined,
    dailyChatLimit: Number.MAX_SAFE_INTEGER,
    dailyImageLimit: Number.MAX_SAFE_INTEGER,
    quotaMode: "unlimited" as const
  };
}

export const licensePlanDefaults = {
  get one_day() {
    return memberQuotaDefaults("one_day");
  },
  get three_day() {
    return memberQuotaDefaults("three_day");
  },
  get week() {
    return memberQuotaDefaults("week");
  },
  get fvip() {
    return memberQuotaDefaults("fvip");
  }
} satisfies Record<Plan, { expiresDays?: number; dailyChatLimit: number; dailyImageLimit: number; quotaMode: MemberQuotaMode }>;

export const checkinPlan = [
  { day: 1, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
  { day: 2, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
  { day: 3, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
  { day: 4, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
  { day: 5, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
  { day: 6, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
  { day: 7, chat: 30, image: 1, randomChat: false, chatMin: 30, chatMax: 30 }
];

const scrypt = promisify(scryptCallback);
const emptyStore = (): StoreData => ({
  devices: {},
  licenses: {},
  accounts: {},
  usageLogs: [],
  feedbacks: []
});

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string) {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const hash = await scrypt(password, salt, 64) as Buffer;
  const storedHash = Buffer.from(hashHex, "hex");
  return hash.length === storedHash.length && timingSafeEqual(hash, storedHash);
}

function accountKey(username: string) {
  return username.trim().toLowerCase();
}

function normalizeAccounts(accounts: Record<string, AccountRecord> = {}) {
  return Object.fromEntries(
    Object.values(accounts).map((account) => [accountKey(account.username), account])
  );
}

async function readStore(): Promise<StoreData> {
  try {
    const data = JSON.parse(await readFile(storePath, "utf-8")) as Partial<StoreData>;
    return {
      devices: data.devices ?? {},
      licenses: data.licenses ?? {},
      accounts: normalizeAccounts(data.accounts),
      usageLogs: data.usageLogs ?? [],
      announcement: data.announcement,
      feedbacks: data.feedbacks ?? []
    };
  } catch {
    return emptyStore();
  }
}

async function writeStore(data: StoreData) {
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(data, null, 2), "utf-8");
}

function dateDaysApart(from?: string, to = today()) {
  if (!from) return Number.POSITIVE_INFINITY;
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function quotaModeForPlan(plan?: Plan): MemberQuotaMode | undefined {
  return plan ? licensePlanDefaults[plan]?.quotaMode : undefined;
}

function currentMemberQuotaMode(device: DeviceRecord): MemberQuotaMode {
  return device.memberQuotaMode ?? quotaModeForPlan(device.memberPlan) ?? "daily";
}

function licenseCodePrefix(plan: Plan) {
  if (plan === "one_day") return "DAY1";
  if (plan === "three_day") return "DAY3";
  return plan.toUpperCase();
}

function randomLicenseCode(plan: Plan) {
  return `${licenseCodePrefix(plan)}-${randomBytes(4).toString("hex").toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function memberGrantExpiresAt(device: DeviceRecord, expiresDays: number) {
  const currentExpires = device.memberExpiresAt ? Date.parse(device.memberExpiresAt) : 0;
  const baseTime = isMember(device) && Number.isFinite(currentExpires)
    ? Math.max(Date.now(), currentExpires)
    : Date.now();
  return new Date(baseTime + expiresDays * 24 * 60 * 60 * 1000).toISOString();
}

function memberPlanAfterGrant(device: DeviceRecord, plan: Plan) {
  if (device.memberPlan === "week" && (plan === "one_day" || plan === "three_day")) return "week";
  if (device.memberPlan === "three_day" && plan === "one_day") return "three_day";
  return plan;
}

function quotaSplitForGrant(baseLimit: number, grantLimit: number, carried: number) {
  return {
    used: Math.max(0, baseLimit - grantLimit),
    carry: carried + Math.max(0, grantLimit - baseLimit)
  };
}

function applyMemberGrantToDevice(data: StoreData, device: DeviceRecord, plan: Plan, expiresDays?: number, grantChat?: number, grantImage?: number) {
  normalizeDevice(device);
  const defaults = licensePlanDefaults[plan];
  const addedChat = grantChat ?? defaults.dailyChatLimit;
  const addedImage = grantImage ?? defaults.dailyImageLimit;

  const loggedIn = Boolean(accountForDevice(data, device.deviceId));
  const carriedChat = remainingFor(device, "chat", loggedIn);
  const carriedImage = remainingFor(device, "image", loggedIn);

  if (plan === "fvip") {
    device.memberPlan = "fvip";
    device.memberQuotaMode = "unlimited";
    device.memberExpiresAt = undefined;
    device.dailyChatLimit = Number.MAX_SAFE_INTEGER;
    device.dailyImageLimit = Number.MAX_SAFE_INTEGER;
  } else if (isFvip(device)) {
    device.memberCarryChatLimit = carriedChat + addedChat;
    device.memberCarryImageLimit = carriedImage + addedImage;
    device.memberCarryChatUsed = 0;
    device.memberCarryImageUsed = 0;
    device.checkinChatBonus = 0;
    device.checkinImageBonus = 0;
    ensureDailyReset(device);
    return true;
  } else {
    const nextPlan = memberPlanAfterGrant(device, plan);
    const nextDefaults = licensePlanDefaults[nextPlan];
    const chatQuota = quotaSplitForGrant(nextDefaults.dailyChatLimit, addedChat, carriedChat);
    const imageQuota = quotaSplitForGrant(nextDefaults.dailyImageLimit, addedImage, carriedImage);
    device.memberPlan = nextPlan;
    device.memberQuotaMode = nextDefaults.quotaMode;
    device.memberExpiresAt = memberGrantExpiresAt(device, expiresDays ?? defaults.expiresDays ?? 0);
    device.dailyChatLimit = nextDefaults.dailyChatLimit;
    device.dailyImageLimit = nextDefaults.dailyImageLimit;
    device.dailyChatUsed = chatQuota.used;
    device.dailyImageUsed = imageQuota.used;
    device.memberCarryChatLimit = chatQuota.carry;
    device.memberCarryImageLimit = imageQuota.carry;
  }

  device.memberCarryChatUsed = 0;
  device.memberCarryImageUsed = 0;
  device.checkinChatBonus = 0;
  device.checkinImageBonus = 0;
  ensureDailyReset(device);
  return true;
}

function applyPendingAccountGrants(data: StoreData, account: AccountRecord, device: DeviceRecord) {
  normalizeDevice(device);
  if ((account.pendingChatBonus ?? 0) > 0) {
    device.checkinChatBonus = (device.checkinChatBonus ?? 0) + (account.pendingChatBonus ?? 0);
    account.pendingChatBonus = 0;
  }
  if ((account.pendingImageBonus ?? 0) > 0) {
    device.checkinImageBonus = (device.checkinImageBonus ?? 0) + (account.pendingImageBonus ?? 0);
    account.pendingImageBonus = 0;
  }
  if (account.pendingFvip) {
    applyMemberGrantToDevice(data, device, "fvip");
    account.pendingFvip = false;
    account.pendingMemberDays = 0;
  } else if ((account.pendingMemberDays ?? 0) > 0) {
    const days = account.pendingMemberDays ?? 0;
    applyMemberGrantToDevice(data, device, days >= 7 ? "week" : "three_day", days);
    account.pendingMemberDays = 0;
  }
}

function normalizeDevice(device: DeviceRecord) {
  device.guestChatLimit ??= GUEST_CHAT_LIMIT;
  device.guestImageLimit ??= GUEST_IMAGE_LIMIT;
  device.guestChatUsed ??= 0;
  device.guestImageUsed ??= 0;
  const accountDefaults = accountQuotaDefaults();
  device.trialChatLimit ??= accountDefaults.chat;
  device.trialImageLimit ??= accountDefaults.image;
  device.trialChatUsed ??= 0;
  device.trialImageUsed ??= 0;
  if (device.memberPlan) {
    device.memberQuotaMode ??= quotaModeForPlan(device.memberPlan);
    const defaults = licensePlanDefaults[device.memberPlan];
    if (defaults && device.memberPlan !== "fvip") {
      if (device.memberQuotaMode === "daily") {
        device.dailyChatLimit = defaults.dailyChatLimit;
        device.dailyImageLimit = defaults.dailyImageLimit;
      } else {
        device.dailyChatLimit ??= defaults.dailyChatLimit;
        device.dailyImageLimit ??= defaults.dailyImageLimit;
      }
    }
  }
  device.dailyChatUsed ??= 0;
  device.dailyImageUsed ??= 0;
  device.memberCarryChatLimit ??= 0;
  device.memberCarryImageLimit ??= 0;
  device.memberCarryChatUsed ??= 0;
  device.memberCarryImageUsed ??= 0;
  device.checkinChatBonus ??= 0;
  device.checkinImageBonus ??= 0;
  device.checkinCycleDay = Math.min(7, Math.max(0, device.checkinCycleDay ?? 0));
  device.lastUsageDate ??= today();
}

function ensureDailyReset(device: DeviceRecord) {
  normalizeDevice(device);
  const day = today();
  if (device.lastUsageDate !== day) {
    const accountDefaults = accountQuotaDefaults();
    device.lastUsageDate = day;
    device.trialChatLimit = accountDefaults.chat;
    device.trialImageLimit = accountDefaults.image;
    device.trialChatUsed = 0;
    device.trialImageUsed = 0;
    if (!isMember(device) || currentMemberQuotaMode(device) === "daily") {
      device.memberCarryChatLimit = 0;
      device.memberCarryImageLimit = 0;
      device.memberCarryChatUsed = 0;
      device.memberCarryImageUsed = 0;
    }
    if (isMember(device) && currentMemberQuotaMode(device) === "daily") {
      device.dailyChatUsed = 0;
      device.dailyImageUsed = 0;
    }
  }
}

function isMember(device: DeviceRecord) {
  if (!device.memberPlan) return false;
  if (!device.memberExpiresAt) return true;
  return new Date(device.memberExpiresAt).getTime() > Date.now();
}

function isFvip(device: DeviceRecord) {
  return device.memberPlan === "fvip" && isMember(device);
}

function guestChatLeft(device: DeviceRecord) {
  return Math.max(0, (device.guestChatLimit ?? GUEST_CHAT_LIMIT) - (device.guestChatUsed ?? 0));
}

function guestImageLeft(device: DeviceRecord) {
  return Math.max(0, (device.guestImageLimit ?? GUEST_IMAGE_LIMIT) - (device.guestImageUsed ?? 0));
}

function accountChatLeft(device: DeviceRecord) {
  return Math.max(0, device.trialChatLimit - device.trialChatUsed);
}

function accountImageLeft(device: DeviceRecord) {
  return Math.max(0, device.trialImageLimit - device.trialImageUsed);
}

function memberChatLeft(device: DeviceRecord) {
  return Math.max(0, (device.dailyChatLimit ?? 0) - device.dailyChatUsed);
}

function memberImageLeft(device: DeviceRecord) {
  return Math.max(0, (device.dailyImageLimit ?? 0) - device.dailyImageUsed);
}

function memberCarryChatLeft(device: DeviceRecord) {
  return Math.max(0, (device.memberCarryChatLimit ?? 0) - (device.memberCarryChatUsed ?? 0));
}

function memberCarryImageLeft(device: DeviceRecord) {
  return Math.max(0, (device.memberCarryImageLimit ?? 0) - (device.memberCarryImageUsed ?? 0));
}

function consumeLayer(device: DeviceRecord, usedKey: "trialChatUsed" | "trialImageUsed" | "dailyChatUsed" | "dailyImageUsed", limit: number) {
  if (device[usedKey] >= limit) return false;
  device[usedKey] += 1;
  return true;
}

function consumeCarryLayer(
  device: DeviceRecord,
  usedKey: "memberCarryChatUsed" | "memberCarryImageUsed",
  limitKey: "memberCarryChatLimit" | "memberCarryImageLimit"
) {
  if ((device[usedKey] ?? 0) >= (device[limitKey] ?? 0)) return false;
  device[usedKey] = (device[usedKey] ?? 0) + 1;
  return true;
}

function consumeBonus(device: DeviceRecord, type: UsageType) {
  if (type === "chat" && (device.checkinChatBonus ?? 0) > 0) {
    device.checkinChatBonus = (device.checkinChatBonus ?? 0) - 1;
    return true;
  }
  if (type === "image" && (device.checkinImageBonus ?? 0) > 0) {
    device.checkinImageBonus = (device.checkinImageBonus ?? 0) - 1;
    return true;
  }
  return false;
}

function checkedInCycleDay(device: DeviceRecord) {
  const daysSinceCheckin = dateDaysApart(device.lastCheckinDate);
  return daysSinceCheckin > 1 ? 0 : Math.min(7, Math.max(0, device.checkinCycleDay ?? 0));
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isUserUsageLog(log: UsageLog) {
  return !log.deviceId.startsWith("admin:")
    && !log.model?.startsWith("admin:")
    && !log.model?.startsWith("grant:")
    && !log.model?.startsWith("announcement:");
}

function deviceHasRealUsage(logs: UsageLog[], deviceId: string) {
  return logs.some((log) => log.deviceId === deviceId && isUserUsageLog(log));
}

function resolveCheckinReward(plan: (typeof checkinPlan)[number]) {
  if (!plan.randomChat) {
    return { day: plan.day, chat: plan.chat, image: plan.image };
  }
  const chat = Math.random() < 0.8 ? randomInt(1, 5) : randomInt(6, 10);
  return { day: plan.day, chat, image: plan.image };
}

function statusFor(device: DeviceRecord, account?: AccountRecord) {
  ensureDailyReset(device);
  const loggedIn = Boolean(account);
  const member = loggedIn && isMember(device);
  const mode: AccountMode = member ? "member" : loggedIn ? "user" : "guest";
  const day = today();
  const checkinCycleDay = checkedInCycleDay(device);
  const canCheckin = loggedIn && device.lastCheckinDate !== day;
  const nextCheckinDay = canCheckin ? (dateDaysApart(device.lastCheckinDate) === 1 ? checkinCycleDay % 7 + 1 : 1) : checkinCycleDay || 1;
  const todayReward = checkinPlan[nextCheckinDay - 1] ?? checkinPlan[0];
  const bonusChat = device.checkinChatBonus ?? 0;
  const bonusImage = device.checkinImageBonus ?? 0;
  const memberQuotaMode = member ? currentMemberQuotaMode(device) : undefined;
  const baseAccountChatLeft = loggedIn ? accountChatLeft(device) : 0;
  const baseAccountImageLeft = loggedIn ? accountImageLeft(device) : 0;
  const guestModeChatLeft = loggedIn ? 0 : guestChatLeft(device);
  const guestModeImageLeft = loggedIn ? 0 : guestImageLeft(device);
  const trialChatLeft = loggedIn && !member ? baseAccountChatLeft + bonusChat : 0;
  const trialImageLeft = loggedIn && !member ? baseAccountImageLeft + bonusImage : 0;
  const dailyChatLeft = member
    ? isFvip(device) ? Number.MAX_SAFE_INTEGER : memberChatLeft(device) + memberCarryChatLeft(device) + bonusChat
    : 0;
  const dailyImageLeft = member
    ? isFvip(device) ? Number.MAX_SAFE_INTEGER : memberImageLeft(device) + memberCarryImageLeft(device) + bonusImage
    : 0;

  return {
    deviceId: device.deviceId,
    mode,
    isLoggedIn: loggedIn,
    username: account?.username,
    isMember: member,
    memberPlan: member ? device.memberPlan : undefined,
    memberQuotaMode,
    memberChatLimit: member && !isFvip(device) ? device.dailyChatLimit ?? 0 : undefined,
    memberImageLimit: member && !isFvip(device) ? device.dailyImageLimit ?? 0 : undefined,
    memberExpiresAt: member ? device.memberExpiresAt : undefined,
    guestChatLeft: guestModeChatLeft,
    guestImageLeft: guestModeImageLeft,
    trialChatLeft,
    trialImageLeft,
    dailyChatLeft,
    dailyImageLeft,
    canCheckin,
    lastCheckinDate: device.lastCheckinDate,
    checkinChatBonus: bonusChat,
    checkinImageBonus: bonusImage,
    bonusChatLeft: bonusChat,
    bonusImageLeft: bonusImage,
    checkinCycleDay,
    nextCheckinDay,
    checkinTodayChatReward: todayReward.chat,
    checkinTodayImageReward: todayReward.image,
    checkinTodayChatRewardMin: todayReward.chatMin,
    checkinTodayChatRewardMax: todayReward.chatMax,
    checkinTodayRandomChat: Boolean(todayReward.randomChat),
    checkinPlan,
    blocked: Boolean(device.blocked)
  };
}

export type PlatformStatus = ReturnType<typeof statusFor>;

function accountForDevice(data: StoreData, deviceId: string) {
  return Object.values(data.accounts).find((account) => account.deviceId === deviceId);
}

function remainingFor(device: DeviceRecord, type: UsageType, loggedIn: boolean) {
  ensureDailyReset(device);
  if (loggedIn && isMember(device)) {
    if (isFvip(device)) return Number.MAX_SAFE_INTEGER;
    if (type === "chat") return memberChatLeft(device) + memberCarryChatLeft(device) + (device.checkinChatBonus ?? 0);
    return memberImageLeft(device) + memberCarryImageLeft(device) + (device.checkinImageBonus ?? 0);
  }
  if (loggedIn) {
    if (type === "chat") return accountChatLeft(device) + (device.checkinChatBonus ?? 0);
    return accountImageLeft(device) + (device.checkinImageBonus ?? 0);
  }
  if (type === "chat") return guestChatLeft(device);
  return guestImageLeft(device);
}

export async function ensureDevice(deviceId: string) {
  const data = await readStore();
  let device = data.devices[deviceId];
  if (!device) {
    device = {
      deviceId,
      createdAt: now(),
      guestChatLimit: GUEST_CHAT_LIMIT,
      guestImageLimit: GUEST_IMAGE_LIMIT,
      guestChatUsed: 0,
      guestImageUsed: 0,
      trialChatLimit: TRIAL_CHAT_LIMIT,
      trialImageLimit: TRIAL_IMAGE_LIMIT,
      trialChatUsed: 0,
      trialImageUsed: 0,
      dailyChatUsed: 0,
      dailyImageUsed: 0,
      checkinChatBonus: 0,
      checkinImageBonus: 0,
      checkinCycleDay: 0,
      lastUsageDate: today()
    };
    data.devices[deviceId] = device;
  }
  normalizeDevice(device);
  await writeStore(data);
  return statusFor(device, accountForDevice(data, deviceId));
}

export async function getStatus(deviceId: string) {
  const data = await readStore();
  const device = data.devices[deviceId];
  if (!device) return ensureDevice(deviceId);
  normalizeDevice(device);
  const status = statusFor(device, accountForDevice(data, deviceId));
  await writeStore(data);
  return status;
}

export async function resolveChatModel(deviceId: string) {
  const data = await readStore();
  const device = data.devices[deviceId];
  if (!device) return "gpt-5.5";
  normalizeDevice(device);
  const account = accountForDevice(data, deviceId);
  if (!account) return "gpt-5.5";
  if (isMember(device) && (device.memberPlan === "three_day" || device.memberPlan === "fvip")) return "gpt-5.5";
  return "gpt-5.4-mini";
}

export async function createLicense(input: {
  plan: Plan;
  quotaMode?: MemberQuotaMode;
  expiresDays?: number;
  dailyChatLimit?: number;
  dailyImageLimit?: number;
}) {
  const data = await readStore();
  const defaults = licensePlanDefaults[input.plan];
  let code = randomLicenseCode(input.plan);
  while (data.licenses[code]) {
    code = randomLicenseCode(input.plan);
  }
  const license: LicenseRecord = {
    code,
    plan: input.plan,
    quotaMode: input.quotaMode ?? quotaModeForPlan(input.plan),
    expiresDays: input.expiresDays ?? defaults.expiresDays,
    dailyChatLimit: input.dailyChatLimit ?? defaults.dailyChatLimit,
    dailyImageLimit: input.dailyImageLimit ?? defaults.dailyImageLimit,
    createdAt: now()
  };
  data.licenses[code] = license;
  await writeStore(data);
  return license;
}

export async function activateLicense(deviceId: string, code: string) {
  const data = await readStore();
  let device = data.devices[deviceId];
  if (!device) {
    await ensureDevice(deviceId);
    const nextData = await readStore();
    device = nextData.devices[deviceId];
    Object.assign(data, nextData);
  }
  normalizeDevice(device);
  const account = accountForDevice(data, deviceId);
  if (!account) throw new Error("登录后才能使用花钥匙。");

  let license = data.licenses[code.trim()];
  if (!license || license.blocked) throw new Error("花钥匙不存在或已失效。");
  if (license.usedByDeviceId && license.usedByDeviceId !== deviceId) throw new Error("这个花钥匙已经绑定其他设备。");
  if (license.plan === "three_day" && (account.threeDayTrialUsed || device.threeDayTrialUsed)) {
    throw new Error("三天试用会员每个账号和设备只能使用一次。");
  }

  license.quotaMode ??= quotaModeForPlan(license.plan);
  const isFirstActivation = !license.usedByDeviceId;
  const carriedChat = isFirstActivation ? remainingFor(device, "chat", true) : memberCarryChatLeft(device);
  const carriedImage = isFirstActivation ? remainingFor(device, "image", true) : memberCarryImageLeft(device);
  const activatedAt = now();
  const expiresAt = license.expiresDays ? memberGrantExpiresAt(device, license.expiresDays) : undefined;

  license.usedByDeviceId = deviceId;
  license.activatedAt = license.activatedAt ?? activatedAt;
  license.expiresAt = license.expiresAt ?? expiresAt;
  if (license.plan === "fvip") {
    device.memberPlan = "fvip";
    device.memberQuotaMode = "unlimited";
    device.memberExpiresAt = undefined;
    device.dailyChatLimit = Number.MAX_SAFE_INTEGER;
    device.dailyImageLimit = Number.MAX_SAFE_INTEGER;
  } else if (isFvip(device)) {
    device.memberPlan = "fvip";
    device.memberQuotaMode = "unlimited";
    device.memberExpiresAt = undefined;
    device.dailyChatLimit = Number.MAX_SAFE_INTEGER;
    device.dailyImageLimit = Number.MAX_SAFE_INTEGER;
  } else {
    const nextPlan = memberPlanAfterGrant(device, license.plan);
    const nextDefaults = licensePlanDefaults[nextPlan];
    const chatQuota = quotaSplitForGrant(nextDefaults.dailyChatLimit, license.dailyChatLimit, carriedChat);
    const imageQuota = quotaSplitForGrant(nextDefaults.dailyImageLimit, license.dailyImageLimit, carriedImage);
    device.memberPlan = nextPlan;
    device.memberQuotaMode = nextDefaults.quotaMode;
    device.memberExpiresAt = license.expiresAt;
    device.dailyChatLimit = nextDefaults.dailyChatLimit;
    device.dailyImageLimit = nextDefaults.dailyImageLimit;
    device.dailyChatUsed = chatQuota.used;
    device.dailyImageUsed = imageQuota.used;
    device.memberCarryChatLimit = chatQuota.carry;
    device.memberCarryImageLimit = imageQuota.carry;
  }
  if (isFirstActivation) {
    device.memberCarryChatUsed = 0;
    device.memberCarryImageUsed = 0;
    device.checkinChatBonus = 0;
    device.checkinImageBonus = 0;
  }
  if (license.plan === "three_day" && isFirstActivation) {
    account.threeDayTrialUsed = true;
    device.threeDayTrialUsed = true;
  }
  ensureDailyReset(device);

  await writeStore(data);
  return statusFor(device, account);
}

export async function grantToRegisteredUsers(input: {
  chat?: number;
  image?: number;
  plan?: Plan;
  reason?: string;
  announce?: boolean;
  announcementTitle?: string;
  announcementContent?: string;
}) {
  const data = await readStore();
  const chat = Math.max(0, Math.floor(input.chat ?? 0));
  const image = Math.max(0, Math.floor(input.image ?? 0));
  const plan = input.plan;
  if (!chat && !image && !plan) {
    throw new Error("请至少填写轻语、花映或会员类型。");
  }

  let accounts = 0;
  let appliedDevices = 0;
  let pendingAccounts = 0;

  for (const account of Object.values(data.accounts)) {
    accounts += 1;
    const device = account.deviceId ? data.devices[account.deviceId] : undefined;
    if (device) {
      normalizeDevice(device);
      if (chat) device.checkinChatBonus = (device.checkinChatBonus ?? 0) + chat;
      if (image) device.checkinImageBonus = (device.checkinImageBonus ?? 0) + image;
      if (plan) applyMemberGrantToDevice(data, device, plan);
      appliedDevices += 1;
    } else {
      if (chat) account.pendingChatBonus = (account.pendingChatBonus ?? 0) + chat;
      if (image) account.pendingImageBonus = (account.pendingImageBonus ?? 0) + image;
      if (plan === "fvip") {
        account.pendingFvip = true;
        account.pendingMemberDays = 0;
      } else if (plan) {
        account.pendingMemberDays = (account.pendingMemberDays ?? 0) + (licensePlanDefaults[plan].expiresDays ?? 0);
      }
      pendingAccounts += 1;
    }
  }

  data.usageLogs.unshift({
    id: crypto.randomUUID(),
    deviceId: "admin:broadcast",
    type: image ? "image" : "chat",
    model: plan ? `grant:${plan}` : "grant:quota",
    success: true,
    message: JSON.stringify({ chat, image, plan, reason: input.reason ?? "" }),
    createdAt: now()
  });
  data.usageLogs = data.usageLogs.slice(0, 1000);

  let announcement: AnnouncementRecord | undefined;
  if (input.announce) {
    const planText = plan === "one_day" ? "一天会员" : plan === "three_day" ? "三天会员" : plan === "week" ? "七天会员" : plan === "fvip" ? "FVIP" : "";
    const parts = [
      chat ? `轻语 +${chat}` : "",
      image ? `花映 +${image}` : "",
      planText ? `${planText}已发放` : ""
    ].filter(Boolean);
    const title = (input.announcementTitle ?? "晚薰福利已到账").trim() || "晚薰福利已到账";
    const content = (input.announcementContent ?? `小花园给注册用户发放了${parts.join("、")}，重新打开或刷新后即可查看。`).trim();
    announcement = {
      enabled: true,
      id: `ann-${Date.now()}-${randomBytes(3).toString("hex")}`,
      title,
      content,
      mode: "banner",
      durationMs: 12_000,
      updatedAt: now()
    };
    data.announcement = announcement;
  }

  await writeStore(data);
  return {
    ok: true,
    target: "registered",
    accounts,
    appliedDevices,
    pendingAccounts,
    granted: { chat, image, plan },
    announcement
  };
}

export async function getAnnouncement() {
  const data = await readStore();
  const announcement = data.announcement;
  if (!announcement) return { enabled: false };
  if (announcement.enabled && process.env.ANNOUNCEMENT_ALWAYS_FRESH === "true") {
    return {
      ...announcement,
      id: `${announcement.id ?? "ann"}-${Date.now()}`,
      updatedAt: now()
    };
  }
  return announcement;
}

export async function publishAnnouncement(input: {
  enabled?: boolean;
  title?: string;
  content?: string;
  mode?: "toast" | "banner" | "modal";
  durationMs?: number;
}) {
  const data = await readStore();
  const content = (input.content ?? "").trim();
  const enabled = input.enabled !== false && content.length > 0;
  const title = (input.title ?? "晚薰公告").trim() || "晚薰公告";
  const mode = input.mode === "banner" || input.mode === "modal" ? input.mode : "toast";
  const durationMs = Math.max(2500, Math.min(60_000, Number(input.durationMs ?? 6000)));
  const announcement: AnnouncementRecord = {
    enabled,
    id: enabled ? `ann-${Date.now()}-${randomBytes(3).toString("hex")}` : data.announcement?.id,
    title,
    content,
    mode,
    durationMs,
    updatedAt: now()
  };
  data.announcement = announcement;
  data.usageLogs.unshift({
    id: randomUUID(),
    deviceId: "admin:announcement",
    type: "chat",
    model: `announcement:${mode}`,
    success: true,
    message: enabled ? title : "announcement disabled",
    createdAt: now()
  });
  data.usageLogs = data.usageLogs.slice(0, 1000);
  await writeStore(data);
  return announcement;
}

export async function getAdminOverview() {
  const data = await readStore();
  const day = today();
  const devices = Object.values(data.devices);
  const accounts = Object.values(data.accounts);
  let guestDevices = 0;
  const members = { oneDay: 0, threeDay: 0, week: 0, fvip: 0 };
  const todayLogs = data.usageLogs.filter((log) => log.createdAt.slice(0, 10) === day);
  const todayUserLogs = todayLogs.filter(isUserUsageLog);
  const activeDeviceIds = new Set(
    todayUserLogs.map((log) => log.deviceId)
  );

  for (const device of devices) {
    normalizeDevice(device);
    const account = accountForDevice(data, device.deviceId);
    if (!account && deviceHasRealUsage(data.usageLogs, device.deviceId)) guestDevices += 1;
    if (isMember(device)) {
      if (device.memberPlan === "one_day") members.oneDay += 1;
      if (device.memberPlan === "three_day") members.threeDay += 1;
      if (device.memberPlan === "week") members.week += 1;
      if (device.memberPlan === "fvip") members.fvip += 1;
    }
  }

  return {
    registeredUsers: accounts.length,
    guestDevices,
    activeToday: activeDeviceIds.size,
    members,
    today: {
      chatCalls: todayUserLogs.filter((log) => log.type === "chat").length,
      imageCalls: todayUserLogs.filter((log) => log.type === "image").length,
      failures: todayUserLogs.filter((log) => !log.success).length,
      avgLatencyMs: 0
    },
    upstreams: {
      chatPrimary: "unknown",
      chatBackup: "unknown",
      image: "unknown"
    },
    updatedAt: now()
  };
}

export async function getAdminUsers() {
  const data = await readStore();
  const logsToday = data.usageLogs.filter((log) => log.createdAt.slice(0, 10) === today() && isUserUsageLog(log));
  const latestLogByDevice = new Map<string, UsageLog>();
  for (const log of data.usageLogs) {
    if (!isUserUsageLog(log)) continue;
    if (!latestLogByDevice.has(log.deviceId)) {
      latestLogByDevice.set(log.deviceId, log);
    }
  }
  const users = Object.values(data.devices).filter((device) => {
    const account = accountForDevice(data, device.deviceId);
    return Boolean(account) || deviceHasRealUsage(data.usageLogs, device.deviceId);
  }).map((device) => {
    normalizeDevice(device);
    const account = accountForDevice(data, device.deviceId);
    const status = statusFor(device, account);
    const todayCalls = logsToday.filter((log) => log.deviceId === device.deviceId).length;
    const failures = logsToday.filter((log) => log.deviceId === device.deviceId && !log.success).length;
    const chatRemaining = status.isMember ? status.dailyChatLeft : status.isLoggedIn ? status.trialChatLeft : status.guestChatLeft;
    const imageRemaining = status.isMember ? status.dailyImageLeft : status.isLoggedIn ? status.trialImageLeft : status.guestImageLeft;
    return {
      username: account?.username,
      deviceId: device.deviceId,
      status: status.isMember ? status.memberPlan ?? "member" : status.isLoggedIn ? "registered" : "guest",
      chatRemaining,
      imageRemaining,
      memberExpiresAt: status.memberExpiresAt,
      lastActiveAt: latestLogByDevice.get(device.deviceId)?.createdAt,
      todayCalls,
      risk: failures >= 3 || todayCalls >= 80 ? "high" : todayCalls >= 30 ? "watch" : "normal"
    };
  });
  await writeStore(data);
  return { users };
}

export async function getAdminUsageLogs(limit = 200) {
  const data = await readStore();
  const accountsByDevice = new Map(Object.values(data.accounts).map((account) => [account.deviceId, account.username]));
  const logs = data.usageLogs.slice(0, Math.max(1, Math.min(1000, limit))).map((log) => ({
    id: log.id,
    createdAt: log.createdAt,
    username: accountsByDevice.get(log.deviceId),
    deviceId: log.deviceId,
    feature: !isUserUsageLog(log)
      ? "管理"
      : log.type === "image"
        ? "花映"
        : "轻语",
    success: log.success,
    latencyMs: undefined,
    error: log.success ? undefined : log.message
  }));
  return { logs };
}

export async function getAdminLicenses(limit = 200) {
  const data = await readStore();
  const licenses = Object.values(data.licenses)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(1, Math.min(1000, limit)))
    .map((license) => ({
      code: license.code,
      plan: license.plan,
      used: Boolean(license.usedByDeviceId),
      usedByDevice: license.usedByDeviceId,
      createdAt: license.createdAt,
      usedAt: license.activatedAt
    }));
  return { licenses };
}

export async function deleteAdminLicense(code: string) {
  const data = await readStore();
  const normalizedCode = code.trim();
  const license = data.licenses[normalizedCode];
  if (!license) throw new Error("激活码不存在。");
  if (license.usedByDeviceId) throw new Error("已使用的激活码不能删除，只能保留用于记录。");
  delete data.licenses[normalizedCode];
  data.usageLogs.unshift({
    id: randomUUID(),
    deviceId: "admin:license-delete",
    type: "chat",
    model: "admin:license-delete",
    success: true,
    message: normalizedCode,
    createdAt: now()
  });
  data.usageLogs = data.usageLogs.slice(0, 1000);
  await writeStore(data);
  return { ok: true, code: normalizedCode };
}

export async function getAdminUserDetail(deviceId: string) {
  const data = await readStore();
  const device = data.devices[deviceId];
  if (!device) throw new Error("设备不存在。");
  normalizeDevice(device);
  const account = accountForDevice(data, deviceId);
  const status = statusFor(device, account);
  const logs = data.usageLogs
    .filter((log) => log.deviceId === deviceId)
    .slice(0, 50);
  await writeStore(data);
  return {
    account,
    device,
    status,
    logs
  };
}

export async function updateAdminUserDevice(deviceId: string, input: {
  addChat?: number;
  addImage?: number;
  setChatRemaining?: number;
  setImageRemaining?: number;
  plan?: Plan | "none";
  memberDays?: number;
  blocked?: boolean;
  reason?: string;
}) {
  const data = await readStore();
  const device = data.devices[deviceId];
  if (!device) throw new Error("设备不存在。");
  normalizeDevice(device);
  const account = accountForDevice(data, deviceId);
  const loggedIn = Boolean(account);

  const addChat = Math.floor(Number(input.addChat ?? 0));
  const addImage = Math.floor(Number(input.addImage ?? 0));
  if (addChat) {
    if (isMember(device)) {
      device.memberCarryChatLimit = Math.max(0, (device.memberCarryChatLimit ?? 0) + addChat);
      device.memberCarryChatUsed = Math.min(device.memberCarryChatUsed ?? 0, device.memberCarryChatLimit);
    } else if (loggedIn) {
      device.trialChatLimit = Math.max(0, device.trialChatLimit + addChat);
      device.trialChatUsed = Math.min(device.trialChatUsed, device.trialChatLimit);
    } else {
      device.guestChatLimit = Math.max(0, (device.guestChatLimit ?? GUEST_CHAT_LIMIT) + addChat);
      device.guestChatUsed = Math.min(device.guestChatUsed ?? 0, device.guestChatLimit);
    }
  }
  if (addImage) {
    if (isMember(device)) {
      device.memberCarryImageLimit = Math.max(0, (device.memberCarryImageLimit ?? 0) + addImage);
      device.memberCarryImageUsed = Math.min(device.memberCarryImageUsed ?? 0, device.memberCarryImageLimit);
    } else if (loggedIn) {
      device.trialImageLimit = Math.max(0, device.trialImageLimit + addImage);
      device.trialImageUsed = Math.min(device.trialImageUsed, device.trialImageLimit);
    } else {
      device.guestImageLimit = Math.max(0, (device.guestImageLimit ?? GUEST_IMAGE_LIMIT) + addImage);
      device.guestImageUsed = Math.min(device.guestImageUsed ?? 0, device.guestImageLimit);
    }
  }

  if (typeof input.setChatRemaining === "number") {
    const target = Math.max(0, Math.floor(input.setChatRemaining));
    if (isMember(device)) {
      device.memberCarryChatLimit = target;
      device.memberCarryChatUsed = 0;
      device.dailyChatUsed = device.dailyChatLimit ?? 0;
      device.checkinChatBonus = 0;
    } else if (loggedIn) {
      device.trialChatLimit = target;
      device.trialChatUsed = 0;
      device.checkinChatBonus = 0;
    } else {
      device.guestChatLimit = target;
      device.guestChatUsed = 0;
    }
  }

  if (typeof input.setImageRemaining === "number") {
    const target = Math.max(0, Math.floor(input.setImageRemaining));
    if (isMember(device)) {
      device.memberCarryImageLimit = target;
      device.memberCarryImageUsed = 0;
      device.dailyImageUsed = device.dailyImageLimit ?? 0;
      device.checkinImageBonus = 0;
    } else if (loggedIn) {
      device.trialImageLimit = target;
      device.trialImageUsed = 0;
      device.checkinImageBonus = 0;
    } else {
      device.guestImageLimit = target;
      device.guestImageUsed = 0;
    }
  }

  if (input.plan === "none") {
    device.memberPlan = undefined;
    device.memberQuotaMode = undefined;
    device.memberExpiresAt = undefined;
    device.dailyChatLimit = undefined;
    device.dailyImageLimit = undefined;
    device.dailyChatUsed = 0;
    device.dailyImageUsed = 0;
    device.memberCarryChatLimit = 0;
    device.memberCarryImageLimit = 0;
    device.memberCarryChatUsed = 0;
    device.memberCarryImageUsed = 0;
  } else if (input.plan) {
    applyMemberGrantToDevice(data, device, input.plan, input.memberDays);
  }

  if (typeof input.blocked === "boolean") {
    device.blocked = input.blocked;
  }

  const status = statusFor(device, account);
  data.usageLogs.unshift({
    id: randomUUID(),
    deviceId,
    type: "chat",
    model: "admin:user-update",
    success: true,
    message: JSON.stringify({
      addChat,
      addImage,
      setChatRemaining: input.setChatRemaining,
      setImageRemaining: input.setImageRemaining,
      plan: input.plan,
      memberDays: input.memberDays,
      blocked: input.blocked,
      reason: input.reason ?? ""
    }),
    createdAt: now()
  });
  data.usageLogs = data.usageLogs.slice(0, 1000);
  await writeStore(data);
  return {
    ok: true,
    deviceId,
    status
  };
}

export async function loginAccount(username: string, password: string, deviceId: string) {
  await ensureDevice(deviceId);
  const data = await readStore();
  const name = username.trim();
  const account = data.accounts[accountKey(name)];
  if (!account) {
    const deviceAccount = accountForDevice(data, deviceId);
    if (deviceAccount) throw new Error(`这台设备注册的账号是 ${deviceAccount.username}，请用这个账号登录。`);
    throw new Error("没有这个账号，请先注册。");
  }
  if (!(await verifyPassword(password, account.passwordHash))) throw new Error("密码不正确。");
  account.token = randomUUID();
  account.deviceId = deviceId;
  const device = data.devices[deviceId];
  normalizeDevice(device);
  applyPendingAccountGrants(data, account, device);
  const status = statusFor(device, account);
  await writeStore(data);
  return { token: account.token, username: account.username, status };
}

export async function registerAccount(username: string, password: string, deviceId: string) {
  await ensureDevice(deviceId);
  const data = await readStore();
  const name = username.trim();
  const key = accountKey(name);
  const usedByDevice = Object.values(data.accounts).some((account) => account.deviceId === deviceId);
  if (usedByDevice) throw new Error("这台设备已经注册过账号，请直接登录。");
  if (data.accounts[key]) throw new Error("这个用户名已经被注册。");
  const token = randomUUID();
  data.accounts[key] = {
    username: name,
    passwordHash: await hashPassword(password),
    token,
    deviceId,
    createdAt: now()
  };
  const device = data.devices[deviceId];
  normalizeDevice(device);
  const inheritedGuestChat = guestChatLeft(device);
  const inheritedGuestImage = guestImageLeft(device);
  const accountDefaults = accountQuotaDefaults();
  device.trialChatLimit = accountDefaults.chat + inheritedGuestChat;
  device.trialImageLimit = accountDefaults.image + inheritedGuestImage;
  device.trialChatUsed = 0;
  device.trialImageUsed = 0;
  device.guestChatUsed = device.guestChatLimit ?? GUEST_CHAT_LIMIT;
  device.guestImageUsed = device.guestImageLimit ?? GUEST_IMAGE_LIMIT;
  const status = statusFor(device, data.accounts[key]);
  await writeStore(data);
  return { token, username: name, status };
}

export async function logoutDevice(deviceId: string) {
  const data = await readStore();
  let device = data.devices[deviceId];
  if (!device) {
    await ensureDevice(deviceId);
    const nextData = await readStore();
    device = nextData.devices[deviceId];
    Object.assign(data, nextData);
  }
  normalizeDevice(device);

  for (const account of Object.values(data.accounts)) {
    if (account.deviceId === deviceId) {
      account.deviceId = "";
      account.token = randomUUID();
    }
  }

  const status = statusFor(device);
  await writeStore(data);
  return status;
}

export async function assertQuota(deviceId: string, type: UsageType) {
  const data = await readStore();
  let device = data.devices[deviceId];
  if (!device) {
    await ensureDevice(deviceId);
    const nextData = await readStore();
    device = nextData.devices[deviceId];
    Object.assign(data, nextData);
  }
  normalizeDevice(device);
  if (device.blocked) throw new Error("该设备已被暂停使用。");
  const loggedIn = Boolean(accountForDevice(data, deviceId));
  if (remainingFor(device, type, loggedIn) <= 0) {
    throw new Error(type === "chat"
      ? "今天的轻语次数用完啦，可以签到、使用花钥匙，或明天再来继续。"
      : "今天的花映次数用完啦，可以签到、使用花钥匙，或明天再来继续。");
  }
  await writeStore(data);
}

export async function checkinDevice(deviceId: string) {
  const data = await readStore();
  let device = data.devices[deviceId];
  if (!device) {
    await ensureDevice(deviceId);
    const nextData = await readStore();
    device = nextData.devices[deviceId];
    Object.assign(data, nextData);
  }
  normalizeDevice(device);
  const account = accountForDevice(data, deviceId);
  if (!account) throw new Error("登录后才能签到。");
  const date = today();
  if (device.lastCheckinDate === date) throw new Error("今天已经签到过啦。");
  const daysSinceCheckin = dateDaysApart(device.lastCheckinDate, date);
  const nextDay = daysSinceCheckin === 1 ? (device.checkinCycleDay ?? 0) % 7 + 1 : 1;
  const reward = resolveCheckinReward(checkinPlan[nextDay - 1] ?? checkinPlan[0]);
  device.checkinChatBonus = (device.checkinChatBonus ?? 0) + reward.chat;
  device.checkinImageBonus = (device.checkinImageBonus ?? 0) + reward.image;
  device.lastCheckinDate = date;
  device.checkinCycleDay = nextDay;
  await writeStore(data);
  return { ...statusFor(device, account), lastCheckinReward: reward };
}

export async function consumeQuota(
  deviceId: string,
  type: UsageType,
  model: string | undefined,
  success: boolean,
  message?: string
) {
  const data = await readStore();
  const device = data.devices[deviceId];
  if (!device) return;
  normalizeDevice(device);
  const loggedIn = Boolean(accountForDevice(data, deviceId));

  if (success) {
    if (loggedIn && isMember(device)) {
      if (!isFvip(device) && type === "chat") {
        if (!consumeLayer(device, "dailyChatUsed", device.dailyChatLimit ?? 0)
          && !consumeCarryLayer(device, "memberCarryChatUsed", "memberCarryChatLimit")) {
          consumeBonus(device, type);
        }
      } else if (!isFvip(device)) {
        if (!consumeLayer(device, "dailyImageUsed", device.dailyImageLimit ?? 0)
          && !consumeCarryLayer(device, "memberCarryImageUsed", "memberCarryImageLimit")) {
          consumeBonus(device, type);
        }
      }
    } else if (loggedIn) {
      if (type === "chat") {
        if (!consumeLayer(device, "trialChatUsed", device.trialChatLimit)) consumeBonus(device, type);
      } else {
        if (!consumeLayer(device, "trialImageUsed", device.trialImageLimit)) consumeBonus(device, type);
      }
    } else if (type === "chat") {
      device.guestChatUsed = (device.guestChatUsed ?? 0) + 1;
    } else {
      device.guestImageUsed = (device.guestImageUsed ?? 0) + 1;
    }
  }

  data.usageLogs.unshift({
    id: crypto.randomUUID(),
    deviceId,
    type,
    model,
    success,
    message,
    createdAt: now()
  });
  data.usageLogs = data.usageLogs.slice(0, 1000);
  await writeStore(data);
}

export async function createFeedback(deviceId: string, content: string) {
  const trimmed = content.trim();
  if (trimmed.length < 2) {
    throw new Error("反馈内容太短啦。");
  }
  if (trimmed.length > 1000) {
    throw new Error("反馈内容最多 1000 字。");
  }

  const data = await readStore();
  let device = data.devices[deviceId];
  if (!device) {
    device = await ensureDevice(deviceId);
  }
  data.devices[deviceId] = device;
  const account = accountForDevice(data, deviceId);
  const createdAt = now();
  const record: FeedbackRecord = {
    id: randomUUID(),
    deviceId,
    username: account?.username,
    content: trimmed,
    status: "open",
    createdAt,
    updatedAt: createdAt
  };

  data.feedbacks.unshift(record);
  data.feedbacks = data.feedbacks.slice(0, 500);
  data.usageLogs.unshift({
    id: randomUUID(),
    deviceId,
    type: "chat",
    model: "feedback",
    success: true,
    message: trimmed.slice(0, 80),
    createdAt
  });
  data.usageLogs = data.usageLogs.slice(0, 1000);
  await writeStore(data);
  return record;
}

export async function getAdminFeedbacks(limit = 200) {
  const data = await readStore();
  return {
    feedbacks: data.feedbacks
      .slice(0, Math.max(1, Math.min(500, limit)))
      .map((feedback) => ({
        ...feedback,
        displayName: feedback.username || `游客 ${feedback.deviceId.slice(0, 8)}`
      }))
  };
}
