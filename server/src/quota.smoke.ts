import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const storeDir = await mkdtemp(path.join(tmpdir(), "garden-quota-"));
process.env.GARDEN_STORE_PATH = path.join(storeDir, "store.json");
process.env.PROMO_QUOTA_END_AT = "2099-01-01T00:00:00.000Z";

const {
  activateLicense,
  consumeQuota,
  createLicense,
  ensureDevice,
  getStatus,
  registerAccount
} = await import("./store.js");

const deviceId = "quota-smoke-device";

await ensureDevice(deviceId);
for (let index = 0; index < 5; index += 1) {
  await consumeQuota(deviceId, "chat", "test", true);
}

let status = await getStatus(deviceId);
assert.equal(status.guestChatLeft, 15);
assert.equal(status.guestImageLeft, 1);

const registered = await registerAccount("QuotaSmokeUser", "Password123", deviceId);
assert.equal(registered.status.trialChatLeft, 115);
assert.equal(registered.status.trialImageLeft, 6);

const license = await createLicense({
  plan: "three_day"
});

status = await activateLicense(deviceId, license.code);
assert.equal(status.dailyChatLeft, 315);
assert.equal(status.dailyImageLeft, 14);
assert.equal(status.bonusChatLeft, 0);
assert.equal(status.bonusImageLeft, 0);
assert.equal(status.memberQuotaMode, "period");

for (let index = 0; index < 120; index += 1) {
  await consumeQuota(deviceId, "chat", "test", true);
}

status = await getStatus(deviceId);
assert.equal(status.dailyChatLeft, 195);
assert.equal(status.trialChatLeft, 0);

for (let index = 0; index < 195; index += 1) {
  await consumeQuota(deviceId, "chat", "test", true);
}

status = await getStatus(deviceId);
assert.equal(status.dailyChatLeft, 0);

const store = JSON.parse(await readFile(process.env.GARDEN_STORE_PATH!, "utf-8")) as {
  devices: Record<string, {
    lastUsageDate: string;
    memberExpiresAt?: string;
    dailyChatUsed: number;
    dailyImageUsed: number;
    trialChatLimit: number;
    trialImageLimit: number;
    trialChatUsed: number;
    trialImageUsed: number;
    memberCarryChatLimit?: number;
    memberCarryImageLimit?: number;
    memberCarryChatUsed?: number;
    memberCarryImageUsed?: number;
  }>;
};
store.devices[deviceId].lastUsageDate = "2000-01-01";
await writeFile(process.env.GARDEN_STORE_PATH!, JSON.stringify(store, null, 2), "utf-8");

status = await getStatus(deviceId);
assert.equal(status.dailyChatLeft, 0);
assert.equal(status.dailyImageLeft, 14);

const expiredStore = JSON.parse(await readFile(process.env.GARDEN_STORE_PATH!, "utf-8")) as typeof store;
expiredStore.devices[deviceId].memberExpiresAt = "2000-01-01T00:00:00.000Z";
await writeFile(process.env.GARDEN_STORE_PATH!, JSON.stringify(expiredStore, null, 2), "utf-8");

status = await getStatus(deviceId);
assert.equal(status.isMember, false);
assert.equal(status.trialChatLeft, 100);
assert.equal(status.trialImageLeft, 5);

const weekDeviceId = "quota-smoke-week-device";
await ensureDevice(weekDeviceId);
await registerAccount("QuotaWeekUser", "Password123", weekDeviceId);
const weekLicense = await createLicense({ plan: "week" });
status = await activateLicense(weekDeviceId, weekLicense.code);
assert.equal(status.dailyChatLeft, 340);
assert.equal(status.dailyImageLeft, 16);
assert.equal(status.memberQuotaMode, "daily");

for (let index = 0; index < 30; index += 1) {
  await consumeQuota(weekDeviceId, "chat", "test", true);
}

const weekStore = JSON.parse(await readFile(process.env.GARDEN_STORE_PATH!, "utf-8")) as typeof store;
weekStore.devices[weekDeviceId].lastUsageDate = "2000-01-01";
await writeFile(process.env.GARDEN_STORE_PATH!, JSON.stringify(weekStore, null, 2), "utf-8");

status = await getStatus(weekDeviceId);
assert.equal(status.dailyChatLeft, 220);
assert.equal(status.dailyImageLeft, 10);

const oneDayDeviceId = "quota-smoke-one-day-device";
await ensureDevice(oneDayDeviceId);
await registerAccount("QuotaOneDayUser", "Password123", oneDayDeviceId);
const oneDayLicense = await createLicense({ plan: "one_day" });
status = await activateLicense(oneDayDeviceId, oneDayLicense.code);
assert.equal(status.memberPlan, "one_day");
assert.equal(status.memberQuotaMode, "period");
assert.equal(status.dailyChatLeft, 220);
assert.equal(status.dailyImageLeft, 9);

const stackDeviceId = "quota-smoke-stack-device";
await ensureDevice(stackDeviceId);
await registerAccount("QuotaStackUser", "Password123", stackDeviceId);
const stackThreeDay = await createLicense({ plan: "three_day" });
status = await activateLicense(stackDeviceId, stackThreeDay.code);
assert.equal(status.memberPlan, "three_day");
assert.equal(status.dailyChatLeft, 320);
assert.equal(status.dailyImageLeft, 14);
const stackOneDay = await createLicense({ plan: "one_day" });
status = await activateLicense(stackDeviceId, stackOneDay.code);
assert.equal(status.memberPlan, "three_day");
assert.equal(status.dailyChatLeft, 420);
assert.equal(status.dailyImageLeft, 17);

const weekStackDeviceId = "quota-smoke-week-stack-device";
await ensureDevice(weekStackDeviceId);
await registerAccount("QuotaWeekStackUser", "Password123", weekStackDeviceId);
const stackWeek = await createLicense({ plan: "week" });
status = await activateLicense(weekStackDeviceId, stackWeek.code);
assert.equal(status.memberPlan, "week");
assert.equal(status.dailyChatLeft, 340);
assert.equal(status.dailyImageLeft, 16);
const weekOneDay = await createLicense({ plan: "one_day" });
status = await activateLicense(weekStackDeviceId, weekOneDay.code);
assert.equal(status.memberPlan, "week");
assert.equal(status.memberQuotaMode, "daily");
assert.equal(status.dailyChatLeft, 440);
assert.equal(status.dailyImageLeft, 19);

const expiredPromoDeviceId = "quota-smoke-expired-promo-device";
process.env.PROMO_QUOTA_END_AT = "2000-01-01T00:00:00.000Z";
await ensureDevice(expiredPromoDeviceId);
status = await registerAccount("QuotaExpiredPromoUser", "Password123", expiredPromoDeviceId).then((result) => result.status);
assert.equal(status.trialChatLeft, 70);
assert.equal(status.trialImageLeft, 3);
const expiredPromoThreeDay = await createLicense({ plan: "three_day" });
status = await activateLicense(expiredPromoDeviceId, expiredPromoThreeDay.code);
assert.equal(status.dailyChatLeft, 250);
assert.equal(status.dailyImageLeft, 11);

const expiredPromoWeekDeviceId = "quota-smoke-expired-promo-week-device";
await ensureDevice(expiredPromoWeekDeviceId);
await registerAccount("QuotaExpiredPromoWeekUser", "Password123", expiredPromoWeekDeviceId);
const expiredPromoWeek = await createLicense({ plan: "week" });
status = await activateLicense(expiredPromoWeekDeviceId, expiredPromoWeek.code);
assert.equal(status.dailyChatLeft, 190);
assert.equal(status.dailyImageLeft, 8);
