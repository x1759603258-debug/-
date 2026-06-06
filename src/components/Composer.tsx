import { SendHorizontal, Square, X } from "lucide-react";
import { DragEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import type { AttachmentInput } from "../lib/desktopApi";

interface ComposerProps {
  loading: boolean;
  value: string;
  files: AttachmentInput[];
  className?: string;
  hideSendIcon?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onFilesChange: (files: AttachmentInput[]) => void;
  onSend: () => void;
  onStop?: () => void;
  confirmLabel?: string;
  onConfirm?: () => void;
  sendLabel?: string;
  loadingLabel?: string;
}

const maxFiles = 5;
const maxImageFileSize = 10 * 1024 * 1024;
const maxDocumentFileSize = 7 * 1024 * 1024;
const maxImagePayloadSize = 420 * 1024;
const maxImageEdge = 1280;
const allowedExtensions = /\.(png|jpe?g|webp|gif|pdf|txt|md|docx?|xlsx?|csv)$/i;

function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",").pop() ?? "" : dataUrl;
  return Math.ceil(base64.length * 0.75);
}

function fileKind(file: AttachmentInput) {
  if (file.mimeType.startsWith("image/")) return "图片";
  if (/\.(xlsx?|csv)$/i.test(file.name)) return "表格";
  if (/\.(pdf|txt|md|docx?)$/i.test(file.name)) return "文档";
  return "文件";
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

async function compressImage(file: File): Promise<AttachmentInput> {
  const original = await readAsDataUrl(file);
  const image = await loadImage(original);
  let scale = Math.min(1, maxImageEdge / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
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
    if (dataUrlBytes(dataUrl) <= maxImagePayloadSize) {
      return { name: file.name.replace(/\.[^.]+$/, ".jpg"), mimeType: "image/jpeg", size: dataUrlBytes(dataUrl), dataUrl };
    }
    if (quality > 0.55) quality -= 0.09;
    else scale *= 0.78;
  }

  return { name: file.name.replace(/\.[^.]+$/, ".jpg"), mimeType: "image/jpeg", size: dataUrlBytes(best), dataUrl: best };
}

async function readFile(file: File): Promise<AttachmentInput> {
  if (file.type.startsWith("image/")) {
    try {
      return await compressImage(file);
    } catch {
      throw new Error("图片压缩失败，请换一张图片。");
    }
  }
  const dataUrl = await readAsDataUrl(file);
  return { name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, dataUrl };
}

export function Composer({ loading, value, files, className, hideSendIcon = false, placeholder = "今天想轻轻聊些什么？", onChange, onFilesChange, onSend, onStop, confirmLabel, onConfirm, sendLabel = "发送", loadingLabel = "停止" }: ComposerProps) {
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }

  useEffect(() => {
    resize();
  }, [value]);

  async function addFiles(fileList: FileList | File[]) {
    setError("");
    const incoming = Array.from(fileList);
    const next = [...files];
    for (const file of incoming) {
      if (next.length >= maxFiles) {
        setError("一次最多放 5 个文件。");
        break;
      }
      const isImage = file.type.startsWith("image/");
      if (isImage && file.size > maxImageFileSize) {
        setError("单张图片不能超过 10MB。");
        continue;
      }
      if (!isImage && file.size > maxDocumentFileSize) {
        setError("单个文件不能超过 7MB。");
        continue;
      }
      if (!isImage && !allowedExtensions.test(file.name)) {
        setError("只支持图片、常见文档和表格文件。");
        continue;
      }
      next.push(await readFile(file));
    }
    onFilesChange(next);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (loading) return;
    if (!value.trim() && files.length === 0) return;
    onSend();
    window.setTimeout(resize, 0);
  }

  function stop(event?: React.MouseEvent<HTMLButtonElement>) {
    event?.preventDefault();
    onStop?.();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    void addFiles(event.dataTransfer.files);
  }

  return (
    <form className={`composer ${className ?? ""}`.trim()} onSubmit={submit} onDragOver={(event) => event.preventDefault()} onDrop={drop}>
      <div className={`composer-main ${files.length ? "has-files" : ""}`}>
        {files.length > 0 && (
          <div className="file-strip" aria-label="已添加的文件">
            {files.map((file, index) => (
              <div className={`file-chip ${file.mimeType.startsWith("image/") ? "image" : ""}`} key={`${file.name}-${index}`}>
                {file.mimeType.startsWith("image/") ? <img src={file.dataUrl} alt={file.name} /> : <b>{fileKind(file)}</b>}
                <span>{file.name}</span>
                <button type="button" disabled={loading} onClick={() => onFilesChange(files.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onInput={resize}
          onKeyDown={keyDown}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        {error && <div className="composer-error">{error}</div>}
      </div>
      <div className="composer-actions">
        {confirmLabel && !loading && (
          <button className="primary-button confirm-image-button" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        )}
        <button
          className={`primary-button send-button ${loading ? "stop" : ""}`}
          type={loading ? "button" : "submit"}
          disabled={(loading && !onStop) || (!loading && !value.trim() && files.length === 0)}
          onClick={loading ? stop : undefined}
        >
          {!hideSendIcon && (loading ? <Square size={15} /> : <SendHorizontal size={18} />)}
          {loading ? loadingLabel : sendLabel}
        </button>
      </div>
    </form>
  );
}
