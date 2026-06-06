import { getSettings } from "./settingsStore.js";

export function apiUrl(baseUrl: string, endpoint: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

export async function platformHeaders() {
  const settings = await getSettings();
  return {
    "Content-Type": "application/json",
    "X-Device-Id": settings.deviceId,
    ...(settings.authToken ? { Authorization: `Bearer ${settings.authToken}` } : {})
  };
}

export async function platformUrl(endpoint: string) {
  const settings = await getSettings();
  return apiUrl(settings.platformBaseUrl, endpoint);
}
