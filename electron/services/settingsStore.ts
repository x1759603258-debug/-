import type { AppSettings } from "../../src/lib/desktopApi.js";
import { fixedPlatformSettings } from "../../src/lib/platformDefaults.js";
import { readJsonFile, writeJsonFile } from "./fileStore.js";

const defaultSettings: AppSettings = {
  platformBaseUrl: fixedPlatformSettings.platformBaseUrl,
  deviceId: "",
  chatModel: fixedPlatformSettings.chatModel,
  imageModel: fixedPlatformSettings.imageModel,
  stream: true
};

function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  return {
    ...defaultSettings,
    ...settings,
    deviceId: settings.deviceId || crypto.randomUUID(),
    platformBaseUrl: fixedPlatformSettings.platformBaseUrl,
    chatModel: fixedPlatformSettings.chatModel,
    imageModel: fixedPlatformSettings.imageModel
  };
}

export async function getSettings(): Promise<AppSettings> {
  const settings = normalizeSettings(await readJsonFile("settings.json", defaultSettings));
  await writeJsonFile("settings.json", settings);
  return settings;
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return writeJsonFile("settings.json", normalizeSettings(settings));
}

export async function saveAuth(token: string, username: string): Promise<AppSettings> {
  const settings = await getSettings();
  return saveSettings({ ...settings, authToken: token, username });
}

export async function clearAuth(): Promise<AppSettings> {
  const settings = await getSettings();
  const { authToken: _authToken, username: _username, ...next } = settings;
  return saveSettings(next);
}
