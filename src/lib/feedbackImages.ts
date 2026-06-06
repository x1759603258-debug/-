import type { FeedbackAttachment } from "./desktopApi";

const maxFeedbackImages = 3;
const maxFeedbackImageFileSize = 10 * 1024 * 1024;
const maxFeedbackImagePayloadSize = 360 * 1024;
const maxFeedbackImageEdge = 1100;

function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",").pop() ?? "" : dataUrl;
  return Math.ceil(base64.length * 0.75);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败"));
    image.src = src;
  });
}

export async function feedbackImageFromFile(file: File): Promise<FeedbackAttachment> {
  if (!file.type.startsWith("image/")) {
    throw new Error("反馈目前只支持拖入图片。");
  }
  if (file.size > maxFeedbackImageFileSize) {
    throw new Error("单张图片不能超过 10MB。");
  }

  const original = await readAsDataUrl(file);
  const image = await loadImage(original);
  let scale = Math.min(1, maxFeedbackImageEdge / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  let quality = 0.82;
  let best = original;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) break;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    best = dataUrlBytes(dataUrl) < dataUrlBytes(best) ? dataUrl : best;
    if (dataUrlBytes(dataUrl) <= maxFeedbackImagePayloadSize) {
      return { name: file.name.replace(/\.[^.]+$/, ".jpg"), mimeType: "image/jpeg", size: dataUrlBytes(dataUrl), dataUrl };
    }
    if (quality > 0.55) quality -= 0.09;
    else scale *= 0.78;
  }

  return { name: file.name.replace(/\.[^.]+$/, ".jpg"), mimeType: "image/jpeg", size: dataUrlBytes(best), dataUrl: best };
}

export function canAddFeedbackImages(current: FeedbackAttachment[], incomingCount: number) {
  return current.length + incomingCount <= maxFeedbackImages;
}

export const feedbackImageLimitText = `最多 ${maxFeedbackImages} 张图片。`;
