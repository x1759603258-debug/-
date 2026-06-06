import { RotateCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage as ChatMessageType, MessageFile } from "../lib/desktopApi";

interface ChatMessageProps {
  message: ChatMessageType;
  onRetry?: (message: ChatMessageType) => void;
  onPreviewImage?: (message: ChatMessageType) => void;
}

function fileLabel(file: MessageFile) {
  if (file.kind === "image") return "图片";
  if (file.kind === "sheet") return "表格";
  if (file.kind === "document") return "文档";
  return "文件";
}

export function ChatMessage({ message, onRetry, onPreviewImage }: ChatMessageProps) {
  const pending = message.role === "assistant" && (message.status === "pending" || !message.content);
  const pendingImage = message.role === "assistant" && message.pendingImage && message.status === "pending";

  return (
    <article className={`chat-bubble ${message.role} ${pending ? "pending" : ""} ${message.status === "failed" ? "failed" : ""}`}>
      {pendingImage ? (
        <div className="image-loading-wrap" aria-label="正在生成图片">
          {message.content && message.content !== "正在生成图片" && (
            <div className="bubble-content image-draft-content">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
          <div className="image-generating-card">
            <div className="image-loading-ambient" />
            <div className="image-loading-grid" />
            <div className="image-loading-shimmer" />
            <div className="image-loading-orbit" />
            <div className="image-reveal-mask" style={{ height: `${Math.max(0, 100 - (message.imageProgress ?? 12))}%` }} />
            <div className="image-progress-rail" aria-hidden="true">
              <span style={{ width: `${Math.max(8, Math.min(100, message.imageProgress ?? 12))}%` }} />
            </div>
            <div className="image-progress-percent">{Math.round(message.imageProgress ?? 12)}%</div>
          </div>
          <div className="image-loading-caption" aria-hidden="true">
            {Array.from(message.imageStage || "正在生成图片").map((char, index) => (
              <span key={`${char}-${index}`} style={{ animationDelay: `${index * 0.08}s` }}>{char}</span>
            ))}
          </div>
        </div>
      ) : message.content ? (
        <div className="bubble-content">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
      ) : pending ? (
        <div className="typing-dots" aria-label="AI 正在回复">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      {message.files && message.files.length > 0 && (
        <div className="message-files">
          {message.files.map((file) => (
            <div className={`message-file ${file.kind === "image" ? "image" : ""}`} key={file.id}>
              {file.kind === "image" && file.dataUrl ? <img src={file.dataUrl} alt={file.name} /> : <b>{fileLabel(file)}</b>}
              <span>{file.name}</span>
            </div>
          ))}
        </div>
      )}
      {message.imageUrl && (
        <button className="generated-image" type="button" onDoubleClick={() => onPreviewImage?.(message)}>
          <img src={message.imageUrl} alt={message.content || "花映图片"} />
        </button>
      )}
      {message.status === "failed" && onRetry && (
        <button className="retry-button" type="button" onClick={() => onRetry(message)} aria-label="重新请求">
          <RotateCw size={13} />
        </button>
      )}
    </article>
  );
}
