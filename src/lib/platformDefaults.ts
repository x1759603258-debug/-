const runtimeProcessEnv = (globalThis as { process?: { argv?: string[]; env?: Record<string, string | undefined> } }).process?.env;
const runtimeProcessArgv = (globalThis as { process?: { argv?: string[] } }).process?.argv ?? [];
const importMetaEnv = import.meta as { env?: Record<string, string | undefined> };

const platformUrlArg = runtimeProcessArgv
  .find((arg) => arg.startsWith("--platform-base-url="))
  ?.slice("--platform-base-url=".length);

const configuredPlatformBaseUrl =
  importMetaEnv.env?.VITE_PLATFORM_BASE_URL ||
  platformUrlArg ||
  runtimeProcessEnv?.PLATFORM_BASE_URL ||
  "http://185.255.95.140:8888";

export const fixedPlatformSettings = {
  platformBaseUrl: configuredPlatformBaseUrl,
  chatModel: "gpt-5.5",
  imageModel: "gpt-image-2"
} as const;
