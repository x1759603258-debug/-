import type { AttachmentInput, ImageRecord } from "../../src/lib/desktopApi.js";
import { platformHeaders, platformUrl } from "./platformClient.js";
import { readJsonResponse } from "./platformResponse.js";
import { getSettings } from "./settingsStore.js";

interface ImageGenerationPayload {
  data?: Array<{ url?: string; b64_json?: string }>;
}

const maxReferenceImageBytes = 680 * 1024;
const maxReferencePayloadBytes = 2.4 * 1024 * 1024;
const maxReferenceImages = 3;
const maxImagePromptChars = 24_000;

export interface ImageGenerationInput {
  prompt: string;
  model?: string;
  size?: string;
  files?: AttachmentInput[];
  signal?: AbortSignal;
}

function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",").pop() ?? "" : dataUrl;
  return Math.ceil(base64.length * 0.75);
}

function compactImageDataUrl(file: AttachmentInput): AttachmentInput | undefined {
  if (!file.dataUrl.startsWith("data:image")) return file;
  const currentBytes = dataUrlBytes(file.dataUrl);
  if (currentBytes <= maxReferenceImageBytes) {
    return { ...file, size: currentBytes };
  }
  return undefined;
}

function compactImageFiles(files: AttachmentInput[]) {
  const compacted: AttachmentInput[] = [];
  let totalBytes = 0;
  for (const file of files) {
    if (compacted.length >= maxReferenceImages) break;
    const next = compactImageDataUrl(file);
    if (!next) continue;
    const bytes = dataUrlBytes(next.dataUrl);
    if (totalBytes + bytes > maxReferencePayloadBytes) continue;
    compacted.push(next);
    totalBytes += bytes;
  }
  return compacted;
}

function imageFileInput(file: AttachmentInput) {
  return {
    name: file.name,
    mimeType: file.mimeType,
    dataUrl: file.dataUrl.startsWith("data:image") ? file.dataUrl : undefined,
    imageUrl: file.dataUrl.startsWith("data:image") ? undefined : file.dataUrl
  };
}

function imageUrlFromPayload(payload: ImageGenerationPayload) {
  const first = payload.data?.[0];
  if (first?.url) return first.url;
  if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
  throw new Error("花映服务没有返回图片。");
}

export async function generateImage(input: ImageGenerationInput): Promise<ImageRecord> {
  const settings = await getSettings();
  const prompt = input.prompt.trim().slice(0, maxImagePromptChars);
  if (!prompt) {
    throw new Error("请先写下想生成的画面。");
  }

  const model = input.model || settings.imageModel;
  const size = input.size || "1024x1024";
  compactImageFiles((input.files ?? []).filter((file) => file.mimeType.startsWith("image/") && file.dataUrl));
  const endpoint = "v1/images/generations";
  const body = { model, prompt, size };

  const response = await fetch(await platformUrl(endpoint), {
    method: "POST",
    headers: await platformHeaders(),
    signal: input.signal,
    body: JSON.stringify(body)
  });
  const payload = await readJsonResponse<ImageGenerationPayload>(response, "花映请求失败。");

  return {
    id: crypto.randomUUID(),
    prompt,
    model,
    size,
    imageUrl: imageUrlFromPayload(payload),
    createdAt: new Date().toISOString()
  };
}
